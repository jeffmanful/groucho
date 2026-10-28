import { isColorsThinSession } from "@/lib/colors-engine"
import { ColorsAssessmentError, generateColorsThinAssessment } from "@/lib/colors-thin-assessment"
import { pendingColorsReport } from "@/lib/colors-post-conversation"
import { alignSuitabilityWithPolicy, suitabilityFromReviewerReport } from "@/lib/colors-suitability"
import { parseClientDecisionPolicy } from "@/lib/decision-policy"
import { COLORS_FORUM_MEMBERSHIP_REPORT_VERSION, normaliseReviewerReport } from "@/lib/reviewer-report"
import { supabase } from "@/lib/supabase"
import { COLORS_ASSESSMENT_LEASE_MS } from "@/lib/admin-session-report"

type Message = { id: string; role: string; content: string; metadata: unknown }

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Reviewer recovery only: never records a decision or sends a completion/decision webhook. */
export async function assessColorsApplication(input: {
  organisationId: string
  projectId: string
  sessionId: string
  requestId?: string
}): Promise<{ status: "ready" | "pending" } | { status: "failed"; error: string; httpStatus: number }> {
  const fail = (error: string, httpStatus: number) => ({ status: "failed" as const, error, httpStatus })
  const [{ data: session, error: sessionError }, { data: project, error: projectError }] = await Promise.all([
    supabase.from("sessions").select("id, session_id, status, profile")
      .eq("id", input.sessionId).eq("project_id", input.projectId).eq("organisation_id", input.organisationId).maybeSingle(),
    supabase.from("projects").select("settings")
      .eq("id", input.projectId).eq("organisation_id", input.organisationId).maybeSingle(),
  ])
  if (sessionError || projectError) return fail("Application could not be loaded.", 503)
  if (!session || !project) return fail("Application not found.", 404)
  if (!["completed", "passed", "redirected", "rejected"].includes(session.status)) {
    return fail("Finish the conversation before generating its assessment.", 409)
  }
  const { data, error: transcriptError } = await supabase.from("messages")
    .select("id, role, content, metadata").eq("session_id", session.id).order("sent_at", { ascending: true })
  if (transcriptError) return fail("The transcript could not be loaded.", 503)
  const rows = (data ?? []) as Message[]
  if (!isColorsThinSession(rows)) return fail("Assessment recovery is available for the newer COLORS conversations.", 409)
  const closing = [...rows].reverse().find(message => message.role === "assistant")
  if (!closing) return fail("The closing message is unavailable.", 409)
  const metadata = record(closing.metadata)
  const startedAt = typeof metadata.colors_demo_report_started_at === "number" ? metadata.colors_demo_report_started_at : 0
  if (metadata.colors_demo_report_status === "generating" && Date.now() - startedAt < COLORS_ASSESSMENT_LEASE_MS) {
    return { status: "pending" }
  }
  const existing = normaliseReviewerReport(metadata.reviewer_report)
  const reusable = metadata.colors_demo_report_status === "ready" && existing?.detailed_opinion &&
    existing.report_version === COLORS_FORUM_MEMBERSHIP_REPORT_VERSION && session.profile
  const generating = { ...metadata, colors_demo_report_status: "generating", colors_demo_report_started_at: Date.now(), colors_demo_report_failure_stage: null }
  // Compare and set: concurrent reviewers cannot both start a paid assessment of this message.
  let claim = supabase.from("messages").update({ metadata: generating }).eq("id", closing.id)
  claim = closing.metadata == null ? claim.is("metadata", null) : claim.eq("metadata", JSON.stringify(closing.metadata))
  const { data: claimed, error: claimError } = await claim.select("id").maybeSingle()
  if (claimError) return fail("The assessment could not be started.", 503)
  if (!claimed) return { status: "pending" }

  let stage = "report_generation"
  try {
    const assessment = reusable
      ? { report: existing!, profile: session.profile }
      : await generateColorsThinAssessment({
          rows, baseReport: pendingColorsReport(rows as Parameters<typeof pendingColorsReport>[0]),
          terminalStatus: session.status, organisationId: input.organisationId, projectId: input.projectId,
          sessionKey: session.session_id, requestId: input.requestId,
        })
    const score = suitabilityFromReviewerReport(assessment.report)
    if (score === null) throw new Error("Assessment has no usable recommendation")
    stage = "profile_persistence"
    const { error: sessionWriteError } = await supabase.from("sessions").update({
      profile: assessment.profile, profile_extracted_at: new Date().toISOString(),
      suitability_score: alignSuitabilityWithPolicy(score, assessment.report.advisory_recommendation, parseClientDecisionPolicy(project.settings)),
    }).eq("id", session.id).eq("project_id", input.projectId).eq("organisation_id", input.organisationId)
    if (sessionWriteError) throw sessionWriteError
    stage = "report_persistence"
    const { error: reportError } = await supabase.from("messages").update({ metadata: {
      ...generating, reviewer_report: assessment.report, colors_demo_report_status: "ready",
    } }).eq("id", closing.id)
    if (reportError) throw reportError
    return { status: "ready" }
  } catch (error) {
    const { error: failureWriteError } = await supabase.from("messages").update({ metadata: {
      ...generating, colors_demo_report_status: "failed",
      colors_demo_report_failure_stage: error instanceof ColorsAssessmentError ? error.stage : stage,
    } }).eq("id", closing.id)
    if (failureWriteError) console.error("assessment failure status:", failureWriteError.code)
    return fail("The assessment could not be completed. Retry without repeating the conversation.", 503)
  }
}
