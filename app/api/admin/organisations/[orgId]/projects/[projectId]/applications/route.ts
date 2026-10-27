import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import {
  applicationFromRow,
  applicationQueueMetrics,
  countApplicationsByQueue,
  listApplications,
  parseApplicationQueueFilters,
  withBand,
} from "@/lib/application-queue"
import { parseClientDecisionPolicy, suitabilityBand } from "@/lib/decision-policy"
import { requireOrgMember, unauthorized } from "@/lib/org-access"
import { supabase } from "@/lib/supabase"

/** The review queue for one project: filtered page, per-queue counts and workload metrics. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string; projectId: string }> },
) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, projectId } = await params
  const deny = await requireOrgMember(actor, orgId)
  if (deny) return deny

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, settings")
    .eq("id", projectId)
    .eq("organisation_id", orgId)
    .maybeSingle()
  if (projectError || !project) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const search = new URL(req.url).searchParams
  const policy = parseClientDecisionPolicy(project.settings)
  const filters = withBand(parseApplicationQueueFilters(search), search.get("band"), policy)
  try {
    const [{ rows, total }, counts, metrics] = await Promise.all([
      listApplications({ organisationId: orgId, projectId, filters }),
      countApplicationsByQueue({ organisationId: orgId, projectId, filters }),
      applicationQueueMetrics({ organisationId: orgId, projectId }),
    ])
    return NextResponse.json({
      applications: rows.map((row) => {
        const item = applicationFromRow(row)
        return {
          ...item,
          assessment: {
            ...item.assessment,
            suitabilityBand: item.assessment.suitabilityScore === null
              ? null : suitabilityBand(item.assessment.suitabilityScore, policy),
          },
        }
      }),
      total,
      counts,
      metrics,
      filters,
      policy: { acceptanceThreshold: policy.acceptanceThreshold, reviewThreshold: policy.reviewThreshold },
    })
  } catch (error) {
    console.error("application queue:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
