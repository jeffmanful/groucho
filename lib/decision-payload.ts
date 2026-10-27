// The body of a decision webhook (`application.decided`, `application.decision_corrected`), built from
// the stored decision when it's delivered.
import { supabase } from "@/lib/supabase"
import { DECISION_EVENTS, type DecisionEvent } from "@/lib/webhook-events"

export type DecisionPayload = {
  event: DecisionEvent
  /** The decision's id; stable across retries. */
  id: string
  occurred_at: string
  project: { id: string; organisation_id: string }
  session: { client_session_key: string; internal_id: string }
  applicant?: { email: string | null; name: string | null }
  decision: "approved" | "declined"
  /** Same as `decision`; matches `reviewStatus` from the sessions API. */
  review_status: "approved" | "declined"
  decision_source: "human" | "policy"
  decided_by: {
    /** dashboard: a reviewer in Groucho. api: your own app, through the API. policy: your automatic decision policy. */
    via: "dashboard" | "api" | "policy"
    email: string | null
    name: string | null
  }
  reason: string | null
  /** A reason the client chose to make shareable with the applicant. Groucho never sends it to them. */
  applicant_reason: string | null
  /** On a correction: the decision it replaces. Revoke or grant access accordingly. */
  supersedes?: { id: string; decision: "approved" | "declined"; decided_at: string }
  advisory_recommendation: "recommend" | "human_review" | "decline" | null
  suitability_score: number | null
  /** Approvals only. Submit it to the access endpoint, or keep it to grant access in your own app. */
  access_secret?: string
}

export async function buildDecisionPayload(
  decisionId: string,
  event: DecisionEvent = DECISION_EVENTS.decided,
): Promise<DecisionPayload | null> {
  const { data: decision, error } = await supabase
    .from("application_decisions")
    .select("*")
    .eq("id", decisionId)
    .maybeSingle()
  if (error || !decision) return null
  const { data: session } = await supabase
    .from("sessions")
    .select("id, session_id, applicant_email, applicant_name, suitability_score")
    .eq("id", decision.session_id as string)
    .maybeSingle()
  if (!session) return null

  let previous: DecisionPayload["supersedes"] | null = null
  if (typeof decision.supersedes_decision_id === "string") {
    const { data: replaced } = await supabase
      .from("application_decisions")
      .select("id, decision, created_at")
      .eq("id", decision.supersedes_decision_id)
      .maybeSingle()
    if (replaced) {
      previous = {
        id: replaced.id as string,
        decision: replaced.decision === "approved" ? "approved" : "declined",
        decided_at: replaced.created_at as string,
      }
    }
  }

  const kind = decision.reviewer_kind as string
  const outcome = decision.decision === "approved" ? "approved" : "declined"
  const score = decision.suitability_score ?? session.suitability_score
  return {
    event,
    id: decision.id as string,
    occurred_at: decision.created_at as string,
    project: { id: decision.project_id as string, organisation_id: decision.organisation_id as string },
    session: { client_session_key: session.session_id as string, internal_id: session.id as string },
    ...(session.applicant_email || session.applicant_name
      ? { applicant: { email: (session.applicant_email as string | null) ?? null, name: (session.applicant_name as string | null) ?? null } }
      : {}),
    decision: outcome,
    review_status: outcome,
    decision_source: decision.decision_source === "policy" ? "policy" : "human",
    decided_by: {
      via: kind === "policy" ? "policy" : kind === "api" ? "api" : "dashboard",
      email: (decision.reviewer_email as string | null) ?? null,
      name: (decision.reviewer_name as string | null | undefined) ?? null,
    },
    reason: (decision.reason as string | null) ?? null,
    applicant_reason: (decision.applicant_reason as string | null | undefined) ?? null,
    ...(previous ? { supersedes: previous } : {}),
    advisory_recommendation: (decision.advisory_recommendation as DecisionPayload["advisory_recommendation"]) ?? null,
    suitability_score: typeof score === "number" ? score : score === null || score === undefined ? null : Number(score),
    ...(outcome === "approved" && typeof decision.access_secret === "string" ? { access_secret: decision.access_secret } : {}),
  }
}
