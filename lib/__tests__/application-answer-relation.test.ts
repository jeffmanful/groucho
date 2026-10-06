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

  it("rejects unknown relation values", () => {
    expect(
      normaliseApplicationAnswerRelation({ kind: "off_topic", reason: "" }),
    ).toBeNull()
  })

  it("recognises a request to clarify the assistant without treating it as a subject shift", () => {
    const relation = normaliseApplicationAnswerRelation({
      kind: "clarification_request",
      reason: "The applicant asks whether the preceding reflection was a question.",
    })
    expect(relation?.kind).toBe("clarification_request")
    expect(applicationAnswerNeedsRepair(relation)).toBe(false)
  })
})
