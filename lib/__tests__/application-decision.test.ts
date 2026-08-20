import { describe, expect, it } from "vitest"
import {
  applicationDecisionActor,
  applicationReviewStatus,
  humanDecisionGrantsAccess,
  parseHumanApplicationDecision,
} from "@/lib/application-decision"

describe("application decision boundary", () => {
  it("accepts only explicit human decision values", () => {
    expect(parseHumanApplicationDecision("approved")).toBe("approved")
    expect(parseHumanApplicationDecision("declined")).toBe("declined")
    expect(parseHumanApplicationDecision("passed")).toBeNull()
    expect(parseHumanApplicationDecision("recommend")).toBeNull()
  })

  it("stores the authenticated reviewer identity", () => {
    expect(
      applicationDecisionActor({ kind: "platform", email: "ops@example.com" }),
    ).toEqual({
      reviewer_kind: "platform",
      reviewer_user_id: null,
      reviewer_email: "ops@example.com",
    })
    expect(
      applicationDecisionActor({
        kind: "member",
        userId: "user-1",
        email: null,
      }),
    ).toEqual({
      reviewer_kind: "member",
      reviewer_user_id: "user-1",
      reviewer_email: null,
    })
  })

  it("keeps conversation completion pending until a human decides", () => {
    expect(applicationReviewStatus({ concluded: false })).toBe("not_ready")
    expect(applicationReviewStatus({ concluded: true })).toBe("pending")
    expect(
      applicationReviewStatus({
        concluded: true,
        decision: { decision: "approved" },
      }),
    ).toBe("approved")
    expect(
      applicationReviewStatus({
        concluded: true,
        decision: { decision: "declined" },
      }),
    ).toBe("declined")
  })

  it("never grants access from an advisory result alone", () => {
    expect(humanDecisionGrantsAccess(null, "legacy-pass-secret")).toBe(false)
    expect(
      humanDecisionGrantsAccess(
        { decision: "recommend", access_secret: "secret" },
        "secret",
      ),
    ).toBe(false)
    expect(
      humanDecisionGrantsAccess(
        { decision: "declined", access_secret: "secret" },
        "secret",
      ),
    ).toBe(false)
  })

  it("grants access only for an approved decision with the exact secret", () => {
    const approved = { decision: "approved", access_secret: "secret" }
    expect(humanDecisionGrantsAccess(approved, undefined)).toBe(false)
    expect(humanDecisionGrantsAccess(approved, "wrong")).toBe(false)
    expect(humanDecisionGrantsAccess(approved, "secret")).toBe(true)
  })
})
