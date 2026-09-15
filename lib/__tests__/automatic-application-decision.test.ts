import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
  single: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({
  supabase: { from: (...args: unknown[]) => mocks.from(...args) },
}))

import { recordAutomaticApplicationDecision } from "@/lib/automatic-application-decision"

describe("automatic application decisions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.single.mockResolvedValue({
      data: { decision: "approved", access_secret: "generated", reviewer_kind: "policy" },
      error: null,
    })
    mocks.insert.mockImplementation((payload: unknown) => ({
      select: () => ({ single: () => mocks.single(payload) }),
    }))
    mocks.from.mockReturnValue({ insert: mocks.insert })
  })

  it("does not write a decision when automatic actions are disabled", async () => {
    const result = await recordAutomaticApplicationDecision({
      organisationId: "org-1",
      projectId: "project-1",
      sessionId: "session-1",
      suitabilityScore: 0.95,
      projectSettings: {},
    })

    expect(result.reviewStatus).toBe("pending")
    expect(result.suitabilityBand).toBe("recommended_acceptance")
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it("records an auditable client-policy approval", async () => {
    const result = await recordAutomaticApplicationDecision({
      organisationId: "org-1",
      projectId: "project-1",
      sessionId: "session-1",
      suitabilityScore: 0.86,
      projectSettings: {
        decision_policy: {
          automatic_acceptance_enabled: true,
          automatic_decline_enabled: false,
          acceptance_threshold: 0.8,
          review_threshold: 0.55,
        },
      },
      advisoryRecommendation: "recommend",
    })

    expect(result.reviewStatus).toBe("approved")
    expect(result.accessSecret).toMatch(/[0-9a-f-]{36}/)
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "approved",
        decision_source: "policy",
        reviewer_kind: "policy",
        suitability_score: 0.86,
        policy_snapshot: expect.objectContaining({
          acceptance_threshold: 0.8,
          automatic_acceptance_enabled: true,
        }),
      }),
    )
  })
})
