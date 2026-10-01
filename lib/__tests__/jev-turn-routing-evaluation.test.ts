import { describe, expect, it, vi } from "vitest"
import {
  JEV_TURN_ROUTING_CASES,
  JEV_TURN_SIGNALS,
} from "@/evals/jev-turn-routing-cases"
import {
  buildJevTurnRoutingQuestions,
  evaluateJevTurnRouting,
  interpretJevTurnRoutingResponse,
  turnRoutingState,
} from "@/lib/jev-turn-routing-evaluation"
import type {
  JevAnswer,
  JevSystemOneResponse,
} from "@/lib/jev-shadow-evaluation"

function choice(value: string): JevAnswer {
  return {
    type: "choice",
    choice: value,
    probabilities: { [value]: 1 },
    confidence: 0.9,
  }
}

function response(input: {
  state: ReturnType<typeof turnRoutingState>
  relation?: string
  quality?: string
  action?: string
  nextSignal?: string
  coverage?: Record<string, number>
  fabrication?: number
  extractiveIntent?: number
  consentViolation?: number
}): JevSystemOneResponse {
  const answers: Record<string, JevAnswer> = {
    answer_relation: choice(input.relation ?? "direct"),
    answer_quality: choice(input.quality ?? "rich"),
    next_action: choice(input.action ?? "advance"),
    next_signal: choice(input.nextSignal ?? "none"),
    admitted_fabrication: { type: "noul", noul: input.fabrication ?? 0.01 },
    repeated_extractive_intent: {
      type: "noul",
      noul: input.extractiveIntent ?? 0.01,
    },
    consent_violation: { type: "noul", noul: input.consentViolation ?? 0.01 },
  }
  for (const signal of input.state.signals) {
    if (!input.state.priorCoveredSignalKeys.includes(signal.key)) {
      answers[`coverage__${signal.key}`] = {
        type: "noul",
        noul: input.coverage?.[signal.key] ?? 0.01,
      }
    }
  }
  return {
    model: "typesafe/jev-1.13-test",
    answers,
    usage: { input_tokens: 100, output_tokens: 20 },
  }
}

describe("Jev turn-routing evaluation", () => {
  it("asks atomic questions only for evidence goals that remain open", () => {
    const calibrationCase = JEV_TURN_ROUTING_CASES.find(
      (candidate) => candidate.id === "terminal-fast-path",
    )!
    const state = turnRoutingState(calibrationCase, JEV_TURN_SIGNALS)
    const questions = buildJevTurnRoutingQuestions(state)

    expect(Object.keys(questions)).toEqual([
      "answer_relation",
      "answer_quality",
      "next_action",
      "next_signal",
      "admitted_fabrication",
      "repeated_extractive_intent",
      "consent_violation",
      "coverage__participation_and_contribution",
    ])
    expect(questions).not.toHaveProperty("recommendation")
    expect(questions).not.toHaveProperty("access_decision")
  })

  it("detects multi-signal coverage independently of the current goal", () => {
    const calibrationCase = JEV_TURN_ROUTING_CASES[0]
    const state = turnRoutingState(calibrationCase, JEV_TURN_SIGNALS)
    const readout = interpretJevTurnRoutingResponse({
      state,
      response: response({
        state,
        nextSignal: "cultural_point_of_view",
        coverage: {
          colors_relationship: 0.96,
          participation_and_contribution: 0.87,
        },
      }),
    })

    expect(readout.coveredSignalKeys).toEqual([
      "colors_relationship",
      "participation_and_contribution",
    ])
    expect(readout.nextSignalKey).toBe("cultural_point_of_view")
    expect(readout.fastClose).toBe(false)
  })

  it("derives the terminal fast path in deterministic code", () => {
    const calibrationCase = JEV_TURN_ROUTING_CASES.find(
      (candidate) => candidate.id === "terminal-fast-path",
    )!
    const state = turnRoutingState(calibrationCase, JEV_TURN_SIGNALS)
    const readout = interpretJevTurnRoutingResponse({
      state,
      response: response({
        state,
        action: "close",
        coverage: { participation_and_contribution: 0.95 },
      }),
    })

    expect(readout.fastClose).toBe(true)
  })

  it("blocks the fast path when a narrow risk predicate is positive", () => {
    const calibrationCase = JEV_TURN_ROUTING_CASES.find(
      (candidate) => candidate.id === "terminal-fast-path-blocked-by-risk",
    )!
    const state = turnRoutingState(calibrationCase, JEV_TURN_SIGNALS)
    const readout = interpretJevTurnRoutingResponse({
      state,
      response: response({
        state,
        quality: "concerning",
        action: "challenge",
        nextSignal: "care_and_feedback",
        coverage: { care_and_feedback: 0.98 },
        consentViolation: 0.99,
      }),
    })

    expect(readout.risk).toBe("consent_violation")
    expect(readout.fastClose).toBe(false)
  })

  it("sends one batched request and fails closed on malformed output", async () => {
    const calibrationCase = JEV_TURN_ROUTING_CASES[0]
    const state = turnRoutingState(calibrationCase, JEV_TURN_SIGNALS)
    const validResponse = response({ state, nextSignal: "cultural_point_of_view" })
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { questions: Record<string, unknown> }
      expect(Object.keys(body.questions)).toHaveLength(11)
      return new Response(JSON.stringify(validResponse), { status: 200 })
    }) as unknown as typeof fetch

    await expect(
      evaluateJevTurnRouting({
        apiKey: "test-key",
        endpoint: "https://example.test/decisions",
        model: "typesafe/jev-test",
        state,
        fetchImpl,
      }),
    ).resolves.toMatchObject({ response: validResponse })
    expect(fetchImpl).toHaveBeenCalledOnce()

    delete validResponse.answers.answer_relation
    expect(() => interpretJevTurnRoutingResponse({ response: validResponse, state })).toThrow(
      "answer_relation",
    )
  })
})
