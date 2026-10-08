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
import { COLORS_DETAILED_REPORT_VERSION, normaliseReviewerReport } from "@/lib/reviewer-report"
import { log } from "@/lib/logger"
import { supabase } from "@/lib/supabase"
import { COLORS_THIN_PILOT_MARKER } from "@/lib/colors-thin-conversation"
import { auditColorsConversationIntegrity, groundColorsProfile, pendingColorsReport } from "@/lib/colors-post-conversation"
import { extractProfile } from "@/lib/profile-extraction"
import { COLORS_PROFILE_EXTRACTOR_HINT, COLORS_PROFILE_SCHEMA, COLORS_THIN_PROFILE_EVIDENCE_HINT } from "@/lib/onboarding-persona-template"
import { modelFromEnv } from "@/lib/llm-usage"

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

function isCurrentReport(
  report: NonNullable<ReturnType<typeof normaliseReviewerReport>>,
  rows: ReportMessage[],
) {
  return Boolean(report.detailed_opinion) &&
    (!isV1Session(rows) || report.report_version === COLORS_DETAILED_REPORT_VERSION)
}

function preliminaryReportForRetry(
  report: NonNullable<ReturnType<typeof normaliseReviewerReport>>,
  rows: ReportMessage[],
) {
  if (!isV1Session(rows) || !report.detailed_opinion || isCurrentReport(report, rows)) {
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
    .select("id, status, persona_id")
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
  if (metadata.colors_demo_report_status === "generating" && Date.now() - startedAt < 90_000) {
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
    const transcriptRows = rows.filter((message): message is ReportMessage & { role: "user" | "assistant" } =>
      message.role === "user" || message.role === "assistant",
    )
    const postAudit = thinPilot
      ? await auditColorsConversationIntegrity({
          messages: transcriptRows,
          requestId: getOrCreateRequestId(req),
          organisationId: project.context.organisationId,
          projectId: project.context.projectId,
          sessionId,
        })
      : { concerns: collectApplicationIntegrityConcerns(transcriptRows), processMessageIds: [] }
    const reportInput = thinPilot
      ? {
          ...preliminaryReport,
          safety_or_integrity_flags: [...new Set(postAudit.concerns.map((concern) => concern.reviewerFlag).filter(Boolean))],
        }
      : preliminaryReport
    const report = await generateDetailedReviewerReport({
      transcript: transcriptRows.map(({ id, role, content }) => ({ id, role, content })),
      baseReport: reportInput,
      facts: collectApplicationFacts(transcriptRows),
      integrityObservations: postAudit.concerns,
      excludedApplicantMessageIds: rows.flatMap((message) =>
        message.role === "user" && record(message.metadata).application_media_request
          ? [message.id]
          : [],
      ).concat(postAudit.processMessageIds),
      requestId: getOrCreateRequestId(req),
      organisationId: project.context.organisationId,
      projectId: project.context.projectId,
      sessionId,
      terminalStatus: session.status,
      rubricVersion: isV1Session(rows) ? COLORS_FORUM_V1_RUBRIC : undefined,
      ...(thinPilot ? { modelOverride: modelFromEnv("GROUCHO_COLORS_THIN_REVIEWER_MODEL", "claude-sonnet-5-5") } : {}),
    })
    failureStage = "report_validation"
    if (!report.detailed_opinion) throw new Error("Detailed report was empty")
    if (thinPilot) {
      failureStage = "profile_extraction"
      const { data: persona } = session.persona_id
        ? await supabase.from("personas")
            .select("profile_schema, profile_extractor_hint")
            .eq("id", session.persona_id)
            .maybeSingle()
        : { data: null }
      const profile = await extractProfile({
        transcript: transcriptRows.map(({ role, content }) => ({ role, content })),
        persona: {
          profile_schema: persona?.profile_schema ?? COLORS_PROFILE_SCHEMA,
          profile_extractor_hint: `${persona?.profile_extractor_hint ?? COLORS_PROFILE_EXTRACTOR_HINT} ${COLORS_THIN_PROFILE_EVIDENCE_HINT}`,
        },
        requestId: getOrCreateRequestId(req),
        organisationId: project.context.organisationId,
        projectId: project.context.projectId,
        sessionId,
        terminalStatus: session.status,
      })
      if (profile.extraction.status !== "ok") throw new Error(profile.extraction.reason)
      const groundedProfile = groundColorsProfile(profile, postAudit.concerns)
      failureStage = "profile_persistence"
      const { error: profileError } = await supabase.from("sessions")
        .update({ profile: groundedProfile, profile_extracted_at: new Date().toISOString() })
        .eq("id", session.id)
      if (profileError) throw profileError
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
    return NextResponse.json({ status: "ready", report })
  } catch (error) {
    const stage = error instanceof DetailedReportGenerationError
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
