import { NextRequest, NextResponse } from "next/server"
import { adminSessionReviewerReport } from "@/lib/admin-session-report"
import { resolveApplicationsKey } from "@/lib/api-key-scopes"
import { withQueueColumns, type QueueRow } from "@/lib/application-queue"
import { parseClientDecisionPolicy } from "@/lib/decision-policy"
import { applicationHistory } from "@/lib/application-outcomes"
import { publicApplication } from "@/lib/public-application"
import { supabase } from "@/lib/supabase"

/** One application with Groucho's assessment and the conversation. Requires an applications key. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const key = await resolveApplicationsKey(req.headers.get("authorization"))
  if (!key.ok) return NextResponse.json({ error: key.error }, { status: key.status })
  const { organisationId, projectId } = key.context
  const clientKey = decodeURIComponent((await params).sessionId).trim()

  const { data: row, error } = await withQueueColumns((columns) =>
    supabase
      .from("application_review_queue")
      .select(columns)
      .eq("organisation_id", organisationId)
      .eq("project_id", projectId)
      .eq("session_id", clientKey)
      .maybeSingle(),
  )
  if (error) {
    console.error("v1 application detail:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const queueRow = row as unknown as QueueRow

  const [{ data: project }, { data: messages }, { data: verdict }] = await Promise.all([
    supabase.from("projects").select("settings").eq("id", projectId).maybeSingle(),
    supabase.from("messages").select("role, content, sent_at, metadata").eq("session_id", queueRow.id).order("sent_at", { ascending: true }),
    supabase.from("verdicts").select("payload").eq("session_id", queueRow.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ])
  const verdictReport = (verdict?.payload as Record<string, unknown> | null)?.reviewer_report ?? null
  const finished = queueRow.queue !== "in_progress"
  const history = await applicationHistory(queueRow.id).catch(() => ({ decisions: [], outcomes: [] }))
  return NextResponse.json({
    application: publicApplication(queueRow, parseClientDecisionPolicy(project?.settings)),
    reviewerReport: finished ? adminSessionReviewerReport(messages ?? [], verdictReport) : null,
    transcript: (messages ?? [])
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({ role: message.role === "user" ? "applicant" : "groucho", content: message.content, sentAt: message.sent_at })),
    decisions: history.decisions,
    outcomes: history.outcomes.map((outcome) => ({ outcome: outcome.outcome, occurredAt: outcome.occurred_at, note: outcome.note })),
  })
}
