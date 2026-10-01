import { describe, expect, it } from "vitest"
import { NARROW_CASES, SIGNAL_KEYS, RISK_KEYS } from "@/evals/jev-narrow-cases"
import { coverageCounts, narrowQuestions, readFacts } from "@/evals/jev-narrow-evaluation"
import type { JevSystemOneResponse } from "@/lib/jev-shadow-evaluation"

describe("narrow Jev experiment", () => {
  it("freezes 50 distinct cases and removes routing decisions from the request", () => {
    expect(NARROW_CASES).toHaveLength(50)
    expect(new Set(NARROW_CASES.map((item) => item.id)).size).toBe(50)
    const questions = narrowQuestions(NARROW_CASES[0].state)
    expect(Object.keys(questions)).toHaveLength(8)
    expect(questions).not.toHaveProperty("next_action")
    expect(questions).not.toHaveProperty("answer_quality")
  })
  it("counts false positives independently from missed coverage", () => {
    expect(coverageCounts(["a", "b"], ["b", "c"])).toEqual({ tp: 1, fp: 1, fn: 1 })
  })
  it("keeps simultaneous risks and rejects invalid probabilities", () => {
    const response: JevSystemOneResponse = {
      model: "fixture", usage: { input_tokens: 1, output_tokens: 1 },
      answers: Object.fromEntries([
        ...SIGNAL_KEYS.map((key) => [`coverage__${key}`, { type: "noul", noul: 0.6 }]),
        ...RISK_KEYS.map((key) => [key, { type: "noul", noul: 0.9 }]),
        ["needs_repair", { type: "noul", noul: 0.1 }],
      ]),
    }
    expect(readFacts(response, true, 0.75).coverage).toEqual([])
    expect(readFacts(response, true, 0.75).risks).toHaveLength(3)
    response.answers.needs_repair = { type: "noul", noul: NaN }
    expect(() => readFacts(response, true, 0.75)).toThrow("Invalid probability")
  })
})
