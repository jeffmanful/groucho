// A client corrects a decision. The old decision stays in the history; the correction replaces it
// from now on and Groucho tells the client's system with `application.decision_corrected`.
import { randomUUID } from "crypto"
import type { HumanApplicationDecision } from "@/lib/application-decision"
import { MAX_DECISION_REASON_LENGTH, reviewerColumns, type DecisionReviewer } from "@/lib/application-decision-record"
import { removeFromCohortsAfterDecline } from "@/lib/cohorts"
import { currentDecisionFor } from "@/lib/current-decision"
import { DECISION_EVENTS, enqueueDecisionWebhooks } from "@/lib/decision-webhook"
import { supabase } from "@/lib/supabase"

/** Corrections come from the client: their team in the dashboard, or their app through the API. */
export type CorrectionReviewer = Exclude<DecisionReviewer, { kind: "platform" }>

export type CorrectedDecision = {
  id: string
  decision: HumanApplicationDecision
  reason: string
  applicant_reason: string | null
  supersedes_decision_id: string
  reviewer_kind: "member" | "api"
  created_at: string
}

export type CorrectionResult =
  | { ok: true; decision: CorrectedDecision; replaced: { id: string; decision: HumanApplicationDecision }; accessSecret: string | null }
  | { ok: false; status: number; error: string; current?: unknown }

const ERRORS: Record<string, { status: number; error: string }> = {
  GR400: { status: 400, error: "A reason is required to correct a decision" },
  GR404: { status: 404, error: "There is no decision to correct" },
  GR409: { status: 409, error: "The decision has changed since you loaded it. Reload and try again." },
  GR422: { status: 422, error: "A correction must change the decision" },
}

export async function correctApplicationDecision(input: {
  organisationId: string
  projectId: string
  /** Internal session id (sessions.id). */
  sessionId: string
  /** The decision the reviewer saw. Omit to correct whatever is current (API convenience). */
  expectedDecisionId?: string | null
  decision: HumanApplicationDecision
  reason: string
  applicantReason?: string | null
  reviewer: CorrectionReviewer
}): Promise<CorrectionResult> {
  const reason = input.reason.trim().slice(0, MAX_DECISION_REASON_LENGTH)
  if (!reason) return { ok: false, ...ERRORS.GR400 }

  const { data: session } = await supabase
    .from("sessions")
    .select("id")
    .eq("id", input.sessionId)
    .eq("project_id", input.projectId)
    .eq("organisation_id", input.organisationId)
    .maybeSingle()
  if (!session) return { ok: false, status: 404, error: "Not found" }

  const { data: current, error: currentError } = await currentDecisionFor<{ id: string; decision: HumanApplicationDecision }>(
    input.sessionId,
    "id, decision",
  )
  if (currentError) {
    console.error("decision correction lookup:", currentError)
    return { ok: false, status: 500, error: "Database error" }
  }
  if (!current) return { ok: false, ...ERRORS.GR404 }

  const columns = reviewerColumns(input.reviewer)
  const accessSecret = input.decision === "approved" ? randomUUID() : null
  const { data, error } = await supabase.rpc("correct_application_decision", {
    p_session_id: input.sessionId,
    p_expected_decision_id: input.expectedDecisionId || current.id,
    p_decision: input.decision,
    p_reason: reason,
    p_applicant_reason: input.applicantReason?.trim().slice(0, MAX_DECISION_REASON_LENGTH) || null,
    p_reviewer_kind: columns.reviewer_kind,
    p_reviewer_user_id: columns.reviewer_user_id ?? null,
    p_reviewer_email: columns.reviewer_email ?? null,
    p_reviewer_name: columns.reviewer_name ?? null,
    p_api_key_id: columns.api_key_id ?? null,
    p_access_secret: accessSecret,
  })

  if (error) {
    const known = error.code ? ERRORS[error.code] : undefined
    if (known) return { ok: false, ...known, ...(error.code === "GR409" ? { current } : {}) }
    if (error.code === "PGRST202" || error.code === "42883") {
      return { ok: false, status: 409, error: "Corrections need the latest database update." }
    }
    console.error("decision correction:", error)
    return { ok: false, status: 500, error: "Database error" }
  }

  const row = (Array.isArray(data) ? data[0] : data) as CorrectedDecision | undefined
  if (!row) return { ok: false, status: 500, error: "Database error" }

  await enqueueDecisionWebhooks({ decisionId: row.id, projectId: input.projectId, event: DECISION_EVENTS.corrected })
  if (row.decision === "declined") {
    // A declined person can't keep a place; the move is recorded and sent as application.allocated.
    await removeFromCohortsAfterDecline({
      sessionId: input.sessionId,
      reason,
      actor: input.reviewer.kind === "api"
        ? { kind: "api", apiKeyId: input.reviewer.apiKeyId }
        : { kind: "member", userId: input.reviewer.userId, email: input.reviewer.email },
    })
  }
  return { ok: true, decision: row, replaced: current, accessSecret: row.decision === "approved" ? accessSecret : null }
}
