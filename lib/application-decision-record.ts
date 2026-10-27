// Records a person's approve or decline, from the dashboard or a client app, and tells webhooks.
import { randomUUID } from "crypto"
import type { HumanApplicationDecision } from "@/lib/application-decision"
import { currentDecisionFor } from "@/lib/current-decision"
import { DECISION_EVENTS, enqueueDecisionWebhooks } from "@/lib/decision-webhook"
import { isConcludedSessionStatus } from "@/lib/session-status"
import { supabase } from "@/lib/supabase"

export const MAX_DECISION_REASON_LENGTH = 1200

export type DecisionReviewer =
  | { kind: "platform"; email: string }
  | { kind: "member"; userId: string; email: string | null }
  /** A client's own app, through an applications-scoped API key, naming its reviewer. */
  | { kind: "api"; apiKeyId: string; email: string | null; name: string | null }

export type RecordedDecision = {
  id: string
  decision: HumanApplicationDecision
  decision_source: "human"
  advisory_recommendation: "recommend" | "human_review" | "decline" | null
  reviewer_kind: "platform" | "member" | "api"
  reason: string | null
  created_at: string
}

export type DecisionResult =
  | { ok: true; decision: RecordedDecision; accessSecret: string | null }
  | { ok: false; status: number; error: string; existing?: unknown }

function advisoryRecommendationFromPayload(payload: unknown): RecordedDecision["advisory_recommendation"] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const report = (payload as Record<string, unknown>).reviewer_report
  if (!report || typeof report !== "object" || Array.isArray(report)) return null
  const recommendation = (report as Record<string, unknown>).advisory_recommendation
  return recommendation === "recommend" || recommendation === "human_review" || recommendation === "decline"
    ? recommendation
    : null
}

// Dashboard decisions only write the original columns, so they keep working before the API migration.
export function reviewerColumns(reviewer: DecisionReviewer): Record<string, unknown> {
  if (reviewer.kind === "platform") {
    return { reviewer_kind: "platform", reviewer_user_id: null, reviewer_email: reviewer.email }
  }
  if (reviewer.kind === "member") {
    return { reviewer_kind: "member", reviewer_user_id: reviewer.userId, reviewer_email: reviewer.email }
  }
  return {
    reviewer_kind: "api",
    reviewer_user_id: null,
    reviewer_email: reviewer.email?.trim().slice(0, 320) || null,
    reviewer_name: reviewer.name?.trim().slice(0, 200) || null,
    api_key_id: reviewer.apiKeyId,
  }
}

/** One decision per application; the first wins. Declines need a reason. */
export async function recordHumanApplicationDecision(input: {
  organisationId: string
  projectId: string
  /** Internal session id (sessions.id). */
  sessionId: string
  decision: HumanApplicationDecision
  reason: string
  /** Optional reason the client may share with the applicant. Groucho never sends it to them. */
  applicantReason?: string | null
  reviewer: DecisionReviewer
}): Promise<DecisionResult> {
  const reason = input.reason.trim().slice(0, MAX_DECISION_REASON_LENGTH)
  const applicantReason = input.applicantReason?.trim().slice(0, MAX_DECISION_REASON_LENGTH) || null
  if (input.decision === "declined" && !reason) {
    return { ok: false, status: 400, error: "A reason is required when declining an application" }
  }

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, status")
    .eq("id", input.sessionId)
    .eq("project_id", input.projectId)
    .eq("organisation_id", input.organisationId)
    .maybeSingle()
  if (sessionError || !session) return { ok: false, status: 404, error: "Not found" }
  // Finished applications from either engine can be decided; the newer COLORS engine ends
  // conversations as `completed`. Active and abandoned sessions cannot.
  if (!isConcludedSessionStatus(session.status) || session.status === "abandoned") {
    return { ok: false, status: 409, error: "Only completed applications can be reviewed" }
  }

  const { data: existing, error: existingError } = await currentDecisionFor(
    input.sessionId,
    "id, decision, decision_source, reviewer_kind, created_at",
  )
  if (existingError) {
    console.error("application decision lookup:", existingError)
    return { ok: false, status: 500, error: "Database error" }
  }
  if (existing) {
    return { ok: false, status: 409, error: "A decision has already been recorded", existing }
  }

  const { data: verdict } = await supabase
    .from("verdicts")
    .select("payload")
    .eq("session_id", input.sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  let advisoryRecommendation = advisoryRecommendationFromPayload(verdict?.payload)
  if (!advisoryRecommendation) {
    // Demo and not-yet-delivered applications keep their report on the closing message.
    const { data: closing } = await supabase
      .from("messages")
      .select("metadata")
      .eq("session_id", input.sessionId)
      .eq("role", "assistant")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    advisoryRecommendation = advisoryRecommendationFromPayload(closing?.metadata)
  }

  const accessSecret = input.decision === "approved" ? randomUUID() : null
  const { data: recorded, error: insertError } = await supabase
    .from("application_decisions")
    .insert({
      organisation_id: input.organisationId,
      project_id: input.projectId,
      session_id: input.sessionId,
      decision: input.decision,
      decision_source: "human",
      advisory_recommendation: advisoryRecommendation,
      ...reviewerColumns(input.reviewer),
      reason: reason || null,
      // Only written when given, so decisions keep working before the corrections migration.
      ...(applicantReason ? { applicant_reason: applicantReason } : {}),
      access_secret: accessSecret,
    })
    .select("id, decision, decision_source, advisory_recommendation, reviewer_kind, reason, created_at")
    .single()

  if (insertError || !recorded) {
    if (insertError?.code === "23505") {
      return { ok: false, status: 409, error: "A decision has already been recorded" }
    }
    console.error("application decision insert:", insertError)
    return { ok: false, status: 500, error: "Database error" }
  }

  await enqueueDecisionWebhooks({ decisionId: recorded.id as string, projectId: input.projectId, event: DECISION_EVENTS.decided })
  return { ok: true, decision: recorded as RecordedDecision, accessSecret }
}
