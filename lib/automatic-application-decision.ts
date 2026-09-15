import { randomUUID } from "crypto"
import {
  clientPolicyDecision,
  parseClientDecisionPolicy,
  serializeClientDecisionPolicy,
  type SuitabilityBand,
} from "@/lib/decision-policy"
import { supabase } from "@/lib/supabase"

type AdvisoryRecommendation = "recommend" | "human_review" | "decline"

export type AutomaticDecisionResult = {
  reviewStatus: "approved" | "declined" | "pending"
  suitabilityScore: number
  suitabilityBand: SuitabilityBand
  accessSecret?: string
}

export async function recordAutomaticApplicationDecision(input: {
  organisationId: string
  projectId: string
  sessionId: string
  suitabilityScore: number
  projectSettings: unknown
  advisoryRecommendation?: AdvisoryRecommendation | null
}): Promise<AutomaticDecisionResult> {
  const suitabilityScore = Math.min(1, Math.max(0, input.suitabilityScore))
  const policy = parseClientDecisionPolicy(input.projectSettings)
  const outcome = clientPolicyDecision(suitabilityScore, policy)
  if (outcome.decision === "pending") {
    return {
      reviewStatus: "pending",
      suitabilityScore,
      suitabilityBand: outcome.band,
    }
  }

  const accessSecret = outcome.decision === "approved" ? randomUUID() : null
  const { data, error } = await supabase
    .from("application_decisions")
    .insert({
      organisation_id: input.organisationId,
      project_id: input.projectId,
      session_id: input.sessionId,
      decision: outcome.decision,
      decision_source: "policy",
      advisory_recommendation: input.advisoryRecommendation ?? null,
      reviewer_kind: "policy",
      reviewer_user_id: null,
      reviewer_email: null,
      reason:
        outcome.decision === "approved"
          ? "Automatically accepted by the client's decision policy."
          : "Automatically declined by the client's decision policy.",
      access_secret: accessSecret,
      suitability_score: suitabilityScore,
      policy_snapshot: serializeClientDecisionPolicy(policy),
    })
    .select("decision, access_secret, reviewer_kind")
    .single()

  if (error?.code === "23505") {
    const { data: existing, error: existingError } = await supabase
      .from("application_decisions")
      .select("decision, access_secret, reviewer_kind")
      .eq("session_id", input.sessionId)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) throw error
    return {
      reviewStatus: existing.decision === "approved" ? "approved" : "declined",
      suitabilityScore,
      suitabilityBand: outcome.band,
      ...(existing.decision === "approved" &&
      existing.reviewer_kind === "policy" &&
      typeof existing.access_secret === "string"
        ? { accessSecret: existing.access_secret }
        : {}),
    }
  }
  if (error || !data) throw error ?? new Error("Automatic decision was not recorded")

  return {
    reviewStatus: outcome.decision,
    suitabilityScore,
    suitabilityBand: outcome.band,
    ...(accessSecret ? { accessSecret } : {}),
  }
}
