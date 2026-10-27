import { NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { applicationHistory } from "@/lib/application-outcomes"
import { requireOrgMember, unauthorized } from "@/lib/org-access"
import { supabase } from "@/lib/supabase"

/** Every decision for an application (including corrections) and the outcomes the client reported. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orgId: string; projectId: string; sessionId: string }> },
) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, projectId, sessionId } = await params
  const deny = await requireOrgMember(actor, orgId)
  if (deny) return deny

  const { data: session } = await supabase
    .from("sessions")
    .select("id, applicant_email")
    .eq("id", sessionId)
    .eq("project_id", projectId)
    .eq("organisation_id", orgId)
    .maybeSingle()
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 })

  try {
    const history = await applicationHistory(session.id as string)
    // Earlier applications by the same person in this project, newest first.
    const { data: earlier } = session.applicant_email
      ? await supabase
          .from("application_review_queue")
          .select("id, session_id, created_at, queue, decision, decision_reason, decided_at")
          .eq("project_id", projectId)
          .eq("applicant_email", session.applicant_email)
          .neq("id", session.id)
          .order("created_at", { ascending: false })
          .limit(5)
      : { data: [] }
    return NextResponse.json({ ...history, earlierApplications: earlier ?? [] })
  } catch (error) {
    console.error("application history:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
