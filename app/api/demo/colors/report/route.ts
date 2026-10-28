import { NextRequest, NextResponse } from "next/server"
import { colorsDemoProject } from "@/lib/colors-demo-access"
import { demoSession } from "@/lib/colors-demo-token"
import {
  DetailedReportGenerationError,
  generateDetailedReviewerReport,
} from "@/lib/detailed-reviewer-report"
import { collectApplicationFacts } from "@/lib/application-facts"
import { COLORS_FORUM_V1_RUBRIC } from "@/lib/application-signal-state"
import { collectApplicationIntegrityConcerns } from "@/lib/application-integrity-concerns"
import { getOrCreateRequestId } from "@/lib/request-trace"
import { COLORS_DETAILED_REPORT_VERSION, COLORS_FORUM_MEMBERSHIP_REPORT_VERSION, normaliseReviewerReport, type ReviewerReport } from "@/lib/reviewer-report"
import { log } from "@/lib/logger"
import { supabase } from "@/lib/supabase"
import { COLORS_THIN_PILOT_MARKER } from "@/lib/colors-thin-conversation"
import { ColorsAssessmentError, generateColorsThinAssessment } from "@/lib/colors-thin-assessment"
import { pendingColorsReport } from "@/lib/colors-post-conversation"
import { alignSuitabilityWithPolicy, suitabilityFromReviewerReport } from "@/lib/colors-suitability"
import { parseClientDecisionPolicy } from "@/lib/decision-policy"
import { COLORS_ASSESSMENT_LEASE_MS } from "@/lib/admin-session-report"

type ReportMessage = {
  id: string
  role: string
  content: string
  metadata: unknown
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function isV1Session(rows: ReportMessage[]) {
  return rows.some((message) =>
    record(message.metadata).application_rubric_version === COLORS_FORUM_V1_RUBRIC,
  )
}

function currentReportVersion(rows: ReportMessage[]) {
  if (rows.some((message) =>
    record(message.metadata).conversation_engine === COLORS_THIN_PILOT_MARKER,
  )) return COLORS_FORUM_MEMBERSHIP_REPORT_VERSION
  return isV1Session(rows) ? COLORS_DETAILED_REPORT_VERSION : null
}

function isCurrentReport(
  report: NonNullable<ReturnType<typeof normaliseReviewerReport>>,
  rows: ReportMessage[],
) {
  const expected = currentReportVersion(rows)
  return Boolean(report.detailed_opinion) &&
    (!expected || report.report_version === expected)
}

function preliminaryReportForRetry(
  report: NonNullable<ReturnType<typeof normaliseReviewerReport>>,
  rows: ReportMessage[],
) {
  if (!currentReportVersion(rows) || !report.detailed_opinion || isCurrentReport(report, rows)) {
    return report
  }
  return {
    ...report,
    detailed_opinion: undefined,
    applicant_bio: "Preliminary transcript snapshot; detailed evidence review is pending.",
    advisory_recommendation: "human_review" as const,
    weak_or_missing_signals: [],
    reviewer_focus: "Complete the full-transcript evidence review before making a decision.",
  }
}

async function load(req: NextRequest, sessionId: string) {
  if (!(await demoSession(req, sessionId))) return { error: "Unauthorized demo session", status: 401 } as const
  const project = await colorsDemoProject()
  if (!project) return { error: "COLORS Forum demo is not configured", status: 503 } as const
  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, status")
    .eq("session_id", sessionId)
    .eq("project_id", project.context.projectId)
    .maybeSingle()
  if (sessionError || !session) return { error: "Demo session not found", status: 404 } as const
  if (!(["passed", "redirected", "rejected", "completed"] as string[]).includes(session.status)) {
    return { error: "Conversation is still in progress", status: 409 } as const
  }
  const { data: messages, error: messagesError } = await supabase
    .from("messages")
    .select("id, role, content, metadata")
    .eq("session_id", session.id)
    .order("sent_at", { ascending: true })
  if (messagesError || !messages?.length) return { error: "Transcript unavailable", status: 503 } as const
  const rows = messages as ReportMessage[]
  const lastAssistant = [...rows].reverse().find((message) => message.role === "assistant")
  if (!lastAssistant) return { error: "Closing message unavailable", status: 503 } as const
  const metadata = record(lastAssistant.metadata)
  const thinPilot = rows.some((message) =>
    record(message.metadata).conversation_engine === COLORS_THIN_PILOT_MARKER,
  )
  const baseReport = normaliseReviewerReport(metadata.reviewer_report) ??
    (thinPilot ? pendingColorsReport(rows) : null)
  if (!baseReport) return { error: "Report evidence unavailable", status: 503 } as const
  return { session, project, rows, lastAssistant, metadata, baseReport, thinPilot } as const
}

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId")?.trim() || ""
  const loaded = await load(req, sessionId)
  if ("error" in loaded) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  const { metadata, baseReport, rows, thinPilot } = loaded
  if (metadata.colors_demo_report_status === "ready" && baseReport.detailed_opinion) {
    return NextResponse.json({
      status: "ready",
      report: baseReport,
      outdated: !isCurrentReport(baseReport, rows),
    })
  }
  if (metadata.colors_demo_report_status === "failed") {
    return NextResponse.json({
      status: "failed",
      ...(thinPilot ? {} : { report: preliminaryReportForRetry(baseReport, rows) }),
      error: thinPilot
        ? "The conversation analysis could not be completed. You can retry without repeating the conversation."
        : "The detailed opinion could not be completed. This is the preliminary evidence snapshot; you can retry the detailed report.",
    })
  }
  return NextResponse.json({ status: "pending" })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : ""
  const loaded = await load(req, sessionId)
  if ("error" in loaded) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  const { session, project, rows, lastAssistant, metadata, baseReport, thinPilot } = loaded
  const preliminaryReport = preliminaryReportForRetry(baseReport, rows)
  if (metadata.colors_demo_report_status === "ready" && isCurrentReport(baseReport, rows)) {
    return NextResponse.json({ status: "ready", report: baseReport })
  }
  const startedAt = typeof metadata.colors_demo_report_started_at === "number"
    ? metadata.colors_demo_report_started_at : 0
  if (metadata.colors_demo_report_status === "generating" && Date.now() - startedAt < COLORS_ASSESSMENT_LEASE_MS) {
    return NextResponse.json({ status: "pending" }, { status: 202 })
  }
  const generatingMetadata = {
    ...metadata,
    colors_demo_report_status: "generating",
    colors_demo_report_started_at: Date.now(),
    colors_demo_report_failure_stage: null,
  }
  const { error: generatingError } = await supabase.from("messages")
    .update({ metadata: generatingMetadata })
    .eq("id", lastAssistant.id)
  if (generatingError) {
    log.warn("colors_demo_report_request_failed", {
      requestId: getOrCreateRequestId(req),
      projectId: project.context.projectId,
      sessionId,
      stage: "report_persistence",
      errorType: "status_update_error",
    })
    return NextResponse.json({ error: "Report status could not be saved" }, { status: 503 })
  }
  let failureStage = "report_generation"
  try {
    let report: ReviewerReport
    if (thinPilot) {
      const assessment = await generateColorsThinAssessment({
        rows,
        baseReport: preliminaryReport,
        terminalStatus: session.status,
        requestId: getOrCreateRequestId(req),
        organisationId: project.context.organisationId,
        projectId: project.context.projectId,
        sessionKey: sessionId,
      })
      report = assessment.report
      failureStage = "profile_persistence"
      const { error: profileError } = await supabase.from("sessions")
        .update({ profile: assessment.profile, profile_extracted_at: new Date().toISOString() })
        .eq("id", session.id)
      if (profileError) throw profileError
    } else {
      const transcriptRows = rows.filter((message): message is ReportMessage & { role: "user" | "assistant" } =>
        message.role === "user" || message.role === "assistant",
      )
      const postAudit = { concerns: collectApplicationIntegrityConcerns(transcriptRows), processMessageIds: [] as string[] }
      report = await generateDetailedReviewerReport({
        transcript: transcriptRows.map(({ id, role, content }) => ({ id, role, content })),
        baseReport: preliminaryReport,
        facts: collectApplicationFacts(transcriptRows),
        integrityObservations: postAudit.concerns,
        excludedApplicantMessageIds: rows.flatMap((message) =>
          message.role === "user" && record(message.metadata).application_media_request
            ? [message.id]
            : [],
        ),
        requestId: getOrCreateRequestId(req),
        organisationId: project.context.organisationId,
        projectId: project.context.projectId,
        sessionId,
        terminalStatus: session.status,
        rubricVersion: isV1Session(rows) ? COLORS_FORUM_V1_RUBRIC : undefined,
        forumMembershipPilot: false,
      })
      failureStage = "report_validation"
      if (!report.detailed_opinion) throw new Error("Detailed report was empty")
    }
    failureStage = "report_persistence"
    const { error } = await supabase.from("messages")
      .update({ metadata: {
        ...generatingMetadata,
        reviewer_report: report,
        colors_demo_report_status: "ready",
      } })
      .eq("id", lastAssistant.id)
    if (error) throw error
    if (thinPilot) {
      // Sort demo applications like real ones; no decision policy or webhook runs for the demo.
      // Optional: a failure here must not turn a ready report into a failed one.
      try {
        const derived = suitabilityFromReviewerReport(report)
        if (derived !== null) {
          const suitabilityScore = alignSuitabilityWithPolicy(
            derived, report.advisory_recommendation, parseClientDecisionPolicy(project.context.settings?.raw),
          )
          const { error: scoreError } = await supabase.from("sessions")
            .update({ suitability_score: suitabilityScore })
            .eq("id", session.id)
          if (scoreError) throw scoreError
        }
      } catch {
        log.warn("colors_demo_suitability_not_saved", { projectId: project.context.projectId, sessionId })
      }
    }
    return NextResponse.json({ status: "ready", report })
  } catch (error) {
    const stage = error instanceof DetailedReportGenerationError || error instanceof ColorsAssessmentError
      ? error.stage
      : failureStage
    log.warn("colors_demo_report_request_failed", {
      requestId: getOrCreateRequestId(req),
      projectId: project.context.projectId,
      sessionId,
      stage,
      errorType: error instanceof Error ? error.name : typeof error,
    })
    const { error: statusError } = await supabase.from("messages")
      .update({ metadata: {
        ...generatingMetadata,
        colors_demo_report_status: "failed",
        colors_demo_report_failure_stage: stage,
      } })
      .eq("id", lastAssistant.id)
    if (statusError) {
      log.error("colors_demo_report_failure_status_not_saved", {
        projectId: project.context.projectId,
        sessionId,
        stage,
      })
    }
    return NextResponse.json({
      status: "failed",
      ...(thinPilot ? {} : { report: preliminaryReport }),
      error: thinPilot
        ? "The conversation analysis could not be completed. You can retry without repeating the conversation."
        : "The detailed opinion could not be completed. This is the preliminary evidence snapshot; you can retry without repeating the conversation.",
    })
  }
}
