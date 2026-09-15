import { describe, expect, it } from "vitest"
import {
  DEFAULT_CLIENT_DECISION_POLICY,
  clientPolicyDecision,
  parseClientDecisionPolicy,
  suitabilityBand,
  validateClientDecisionPolicy,
} from "@/lib/decision-policy"

describe("client decision policy", () => {
  it("keeps both automatic actions disabled by default", () => {
    expect(parseClientDecisionPolicy({})).toEqual(DEFAULT_CLIENT_DECISION_POLICY)
    expect(
      clientPolicyDecision(0.95, DEFAULT_CLIENT_DECISION_POLICY).decision,
    ).toBe("pending")
    expect(
      clientPolicyDecision(0.2, DEFAULT_CLIENT_DECISION_POLICY).decision,
    ).toBe("pending")
  })

  it("sorts scores into acceptance, review, and below-threshold bands", () => {
    expect(suitabilityBand(0.8, DEFAULT_CLIENT_DECISION_POLICY)).toBe(
      "recommended_acceptance",
    )
    expect(suitabilityBand(0.65, DEFAULT_CLIENT_DECISION_POLICY)).toBe("review")
    expect(suitabilityBand(0.54, DEFAULT_CLIENT_DECISION_POLICY)).toBe(
      "below_threshold",
    )
  })

  it("applies acceptance and decline independently", () => {
    const acceptOnly = {
      ...DEFAULT_CLIENT_DECISION_POLICY,
      automaticAcceptanceEnabled: true,
    }
    expect(clientPolicyDecision(0.9, acceptOnly).decision).toBe("approved")
    expect(clientPolicyDecision(0.2, acceptOnly).decision).toBe("pending")

    const declineOnly = {
      ...DEFAULT_CLIENT_DECISION_POLICY,
      automaticDeclineEnabled: true,
    }
    expect(clientPolicyDecision(0.9, declineOnly).decision).toBe("pending")
    expect(clientPolicyDecision(0.2, declineOnly).decision).toBe("declined")
  })

  it("rejects overlapping thresholds", () => {
    expect(
      validateClientDecisionPolicy({
        ...DEFAULT_CLIENT_DECISION_POLICY,
        acceptanceThreshold: 0.5,
        reviewThreshold: 0.5,
      }),
    ).toMatch(/lower/i)
  })
})
