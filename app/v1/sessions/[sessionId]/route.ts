import { NextRequest } from "next/server"
import { applicantIdentityFromRow } from "@/lib/applicant-identity"
import { log } from "@/lib/logger"
import { getOrCreateRequestId } from "@/lib/request-trace"
import { resolveProjectContext } from "@/lib/project-resolution"
import type { OnboardingFlowStep } from "@/lib/project-settings"
import { outcomeLabelFromDbStatus } from "@/lib/session-outcome"
import { supabase } from "@/lib/supabase"
import { isConcludedSessionStatus } from "@/lib/session-status"
import { tracedJson } from "@/lib/with-request-trace"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const authHeader = req.headers.get("authorization")
  const projectResolved = await resolveProjectContext(authHeader)
  if (!projectResolved.ok) {
    return tracedJson(req, projectResolved.body, {
      status: projectResolved.status,
    })
  }
  const { projectId, settings } = projectResolved.context

  const { sessionId: rawId } = await params
  const clientKey = decodeURIComponent(rawId).trim()

  const { data: row, error } = await supabase
    .from("sessions")
    .select(
      "id, session_id, status, created_at, updated_at, current_step_id, flow_version, profile, onboarding_state, applicant_email, applicant_name",
    )
    .eq("session_id", clientKey)
    .eq("project_id", projectId)
    .maybeSingle()

  if (error) {
    log.error("v1_get_session_failed", {
      requestId: getOrCreateRequestId(req),
      projectId,
      detail: error.message,
    })
    return tracedJson(req, { error: "Database error" }, { status: 500 })
  }
  if (!row) {
    return tracedJson(req, { error: "Not found" }, { status: 404 })
  }

  const { count: turnCount } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("session_id", row.id)
    .eq("role", "user")

  const outcome = outcomeLabelFromDbStatus(row.status)
  const concluded = isConcludedSessionStatus(row.status)
  const applicant = applicantIdentityFromRow(row)

  let profile: unknown = row.profile ?? null
  let reviewerReport: unknown = null
  if (concluded) {
    const { data: v } = await supabase
      .from("verdicts")
      .select("payload")
      .eq("session_id", row.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    const payload = (v?.payload as Record<string, unknown> | undefined) ?? null
    if (!profile && payload && typeof payload === "object" && payload.profile) {
      profile = payload.profile
    }
    if (payload && typeof payload === "object" && payload.reviewer_report) {
      reviewerReport = payload.reviewer_report
    }
  }

  const steps: OnboardingFlowStep[] = settings.flowConfig?.steps ?? []
  const welcomeMessage = settings.flowConfig?.welcome_message?.trim() || null
  let currentStep: {
    id: string
    title: string
    index: number
    total: number
    interaction?: OnboardingFlowStep["interaction"]
  } | null = null
  let stepHint: string | null = null
  if (
    settings.projectType === "onboarding" &&
    !concluded &&
    row.current_step_id &&
    steps.length
  ) {
    const idx = steps.findIndex((s) => s.id === row.current_step_id)
    if (idx >= 0) {
      currentStep = {
        id: steps[idx].id,
        title: steps[idx].title,
        index: idx,
        total: steps.length,
        ...(steps[idx].interaction ? { interaction: steps[idx].interaction } : {}),
      }
      stepHint = steps[idx].hint?.trim() || null
    }
  }

  let messages: { role: string; content: string }[] | undefined
  if (settings.projectType === "onboarding" && !concluded) {
    const { data: msgRows } = await supabase
      .from("messages")
      .select("role, content")
      .eq("session_id", row.id)
      .order("sent_at", { ascending: true })
      .limit(50)
    if (msgRows?.length) {
      messages = msgRows.map((m) => ({
        role: m.role,
        content: m.content,
      }))
    }
  }

  return tracedJson(req, {
    id: row.id,
    clientSessionKey: row.session_id,
    status: row.status,
    outcome,
    turnsUsed: turnCount ?? 0,
    startedAt: row.created_at,
    completedAt: concluded ? row.updated_at : null,
    ...(applicant ? { applicant } : {}),
    projectType: settings.projectType,
    flowVersion: row.flow_version ?? settings.flowConfig?.version ?? null,
    ...(welcomeMessage ? { welcomeMessage } : {}),
    ...(currentStep ? { currentStep } : {}),
    ...(stepHint ? { stepHint } : {}),
    ...(messages ? { messages } : {}),
    ...(profile ? { profile } : {}),
    ...(reviewerReport ? { reviewerReport } : {}),
  })
}
