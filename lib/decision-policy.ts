export type ClientDecisionPolicy = {
  automaticAcceptanceEnabled: boolean
  automaticDeclineEnabled: boolean
  acceptanceThreshold: number
  reviewThreshold: number
}

export type SuitabilityBand =
  | "recommended_acceptance"
  | "review"
  | "below_threshold"

export type PolicyDecision = "approved" | "declined" | "pending"

export const DEFAULT_CLIENT_DECISION_POLICY: ClientDecisionPolicy = {
  automaticAcceptanceEnabled: false,
  automaticDeclineEnabled: false,
  acceptanceThreshold: 0.8,
  reviewThreshold: 0.55,
}

function score(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback
}

export function parseClientDecisionPolicy(settings: unknown): ClientDecisionPolicy {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return { ...DEFAULT_CLIENT_DECISION_POLICY }
  }
  const raw = (settings as Record<string, unknown>).decision_policy
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_CLIENT_DECISION_POLICY }
  }
  const policy = raw as Record<string, unknown>
  return {
    automaticAcceptanceEnabled: policy.automatic_acceptance_enabled === true,
    automaticDeclineEnabled: policy.automatic_decline_enabled === true,
    acceptanceThreshold: score(
      policy.acceptance_threshold,
      DEFAULT_CLIENT_DECISION_POLICY.acceptanceThreshold,
    ),
    reviewThreshold: score(
      policy.review_threshold,
      DEFAULT_CLIENT_DECISION_POLICY.reviewThreshold,
    ),
  }
}

export function serializeClientDecisionPolicy(
  policy: ClientDecisionPolicy,
): Record<string, unknown> {
  return {
    automatic_acceptance_enabled: policy.automaticAcceptanceEnabled,
    automatic_decline_enabled: policy.automaticDeclineEnabled,
    acceptance_threshold: score(
      policy.acceptanceThreshold,
      DEFAULT_CLIENT_DECISION_POLICY.acceptanceThreshold,
    ),
    review_threshold: score(
      policy.reviewThreshold,
      DEFAULT_CLIENT_DECISION_POLICY.reviewThreshold,
    ),
  }
}

export function validateClientDecisionPolicy(
  policy: ClientDecisionPolicy,
): string | null {
  if (policy.reviewThreshold >= policy.acceptanceThreshold) {
    return "The review threshold must be lower than the automatic acceptance threshold."
  }
  return null
}

export function suitabilityBand(
  suitabilityScore: number,
  policy: ClientDecisionPolicy,
): SuitabilityBand {
  const value = score(suitabilityScore, 0.5)
  if (value >= policy.acceptanceThreshold) return "recommended_acceptance"
  if (value >= policy.reviewThreshold) return "review"
  return "below_threshold"
}

export function clientPolicyDecision(
  suitabilityScore: number,
  policy: ClientDecisionPolicy,
): { band: SuitabilityBand; decision: PolicyDecision } {
  const band = suitabilityBand(suitabilityScore, policy)
  if (band === "recommended_acceptance" && policy.automaticAcceptanceEnabled) {
    return { band, decision: "approved" }
  }
  if (band === "below_threshold" && policy.automaticDeclineEnabled) {
    return { band, decision: "declined" }
  }
  return { band, decision: "pending" }
}
