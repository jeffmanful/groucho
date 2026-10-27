import { NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { applicationFromRow, withQueueColumns, type QueueRow } from "@/lib/application-queue"
import { parseClientDecisionPolicy, suitabilityBand } from "@/lib/decision-policy"
import { fetchOrgRole, requireOrgMember, unauthorized } from "@/lib/org-access"
import { supabase } from "@/lib/supabase"

/** One application as the review queue sees it, plus what the viewer may do with it. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orgId: string; projectId: string; sessionId: string }> },
) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, projectId, sessionId } = await params
  const deny = await requireOrgMember(actor, orgId)
  if (deny) return deny

  const [{ data: project }, { data: row, error }, role] = await Promise.all([
    supabase.from("projects").select("id, name, settings").eq("id", projectId).eq("organisation_id", orgId).maybeSingle(),
    withQueueColumns((columns) =>
      supabase
        .from("application_review_queue")
        .select(columns)
        .eq("organisation_id", orgId)
        .eq("project_id", projectId)
        .eq("id", sessionId)
        .maybeSingle(),
    ),
    actor.kind === "platform" ? Promise.resolve(null) : fetchOrgRole(actor.userId, orgId),
  ])
  // A malformed id (for example a broken link) is simply not found.
  if (error?.code === "22P02") return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (error) {
    console.error("application:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
  if (!project || !row) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const policy = parseClientDecisionPolicy(project.settings)
  const item = applicationFromRow(row as unknown as QueueRow)
  const canDecide = actor.kind === "platform" || role === "owner" || role === "admin"
  return NextResponse.json({
    application: {
      ...item,
      assessment: {
        ...item.assessment,
        suitabilityBand: item.assessment.suitabilityScore === null ? null : suitabilityBand(item.assessment.suitabilityScore, policy),
      },
    },
    project: { id: project.id, name: project.name },
    policy: { acceptanceThreshold: policy.acceptanceThreshold, reviewThreshold: policy.reviewThreshold },
    permissions: {
      canDecide,
      // Corrections come from the organisation's own owners and admins.
      canCorrect: actor.kind !== "platform" && (role === "owner" || role === "admin"),
    },
  })
}
