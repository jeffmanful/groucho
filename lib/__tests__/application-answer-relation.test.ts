import { describe, expect, it } from "vitest"
import {
  applicationAnswerNeedsRepair,
  normaliseApplicationAnswerRelation,
} from "@/lib/application-answer-relation"

describe("application answer relation", () => {
  it("keeps answer relevance separate from answer quality", () => {
    const relation = normaliseApplicationAnswerRelation({
      kind: "subject_shift",
      reason: "The applicant named an artist instead of describing a project.",
    })

    expect(relation).toEqual({
      kind: "subject_shift",
      reason: "The applicant named an artist instead of describing a project.",
    })
    expect(applicationAnswerNeedsRepair(relation)).toBe(true)
  })

  it("repairs ambiguity but lets direct and partial answers continue", () => {
    expect(
      applicationAnswerNeedsRepair(
        normaliseApplicationAnswerRelation({ kind: "ambiguous", reason: "" }),
      ),
    ).toBe(true)
    expect(
      applicationAnswerNeedsRepair(
        normaliseApplicationAnswerRelation({ kind: "direct", reason: "" }),
      ),
    ).toBe(false)
    expect(
      applicationAnswerNeedsRepair(
        normaliseApplicationAnswerRelation({ kind: "partial", reason: "" }),
      ),
    ).toBe(false)
  })

  it("rejects unknown relation values", () => {
    expect(
      normaliseApplicationAnswerRelation({ kind: "off_topic", reason: "" }),
    ).toBeNull()
  })
})
