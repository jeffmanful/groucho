import { describe, expect, it, vi } from "vitest"
import {
  buildJevShadowRequest,
  evaluateJevShadow,
  interpretJevShadowResponse,
  JEV_SHADOW_MODEL,
  OPENROUTER_JEV_SHADOW_ENDPOINT,
  OPENROUTER_JEV_SHADOW_MODEL,
  primaryJevShadowRisk,
  type JevSystemOneResponse,
} from "@/lib/jev-shadow-evaluation"

function response(overrides: Partial<Record<string, number | string>> = {}): JevSystemOneResponse {
  const score = (key: string) => ({
    type: "score" as const,
    score: Number(overrides[key] ?? 2.4),
    legend: { "0": "none", "1": "low", "2": "good", "3": "strong" },
    probabilities: { "0": 0, "1": 0.1, "2": 0.4, "3": 0.5 },
    confidence: 0.8,
  })
  const noul = (key: string) => ({ type: "noul" as const, noul: Number(overrides[key] ?? 0.05) })
  return {
    model: JEV_SHADOW_MODEL,
    answers: {
      specificity: score("specificity"),
      reciprocity: score("reciprocity"),
      cultural_depth: score("cultural_depth"),
      contribution: score("contribution"),
      evidence_sufficiency: {
        type: "choice",
        choice: String(overrides.evidence_sufficiency ?? "sufficient"),
        probabilities: { insufficient: 0.05, mixed: 0.1, sufficient: 0.85 },
        confidence: 0.8,
      },
      orientation: {
        type: "choice",
        choice: String(overrides.orientation ?? "artist"),
        probabilities: { artist: 0.9, curator: 0.03, enthusiast: 0.03, hybrid: 0.03, unknown: 0.01 },
        confidence: 0.9,
      },
      admitted_fabrication: noul("admitted_fabrication"),
      repeated_extractive_intent: noul("repeated_extractive_intent"),
      consent_violation: noul("consent_violation"),
    },
    usage: { input_tokens: 500, output_tokens: 50 },
  }
}

describe("Jev shadow evaluation", () => {
  it("builds one atomic, batched request without a direct recommendation question", () => {
    const request = buildJevShadowRequest({
      applicantEvidence: ["Synthetic evidence"],
      neutralMissingInformation: ["Audience size"],
    })
    expect(request.model).toBe("jev-1.13.0")
    expect(Object.keys(request.questions)).toHaveLength(9)
    expect(request.questions).not.toHaveProperty("recommendation")
    expect(request.state).toEqual({
      applicantEvidence: ["Synthetic evidence"],
      neutralMissingInformation: ["Audience size"],
    })
  })

  it("recommends only sufficiently evidenced, reciprocal cases without high risks", () => {
    const readout = interpretJevShadowResponse(response())
    expect(readout.recommendation).toBe("recommend")
    expect(readout.composite).toBeCloseTo(0.8)
  })

  it("routes admitted fabrication and extractive intent to human review", () => {
    expect(
      interpretJevShadowResponse(response({ admitted_fabrication: 0.9 })).recommendation,
    ).toBe("human_review")
    expect(
      interpretJevShadowResponse(response({ repeated_extractive_intent: 0.9 })).recommendation,
    ).toBe("human_review")
  })

  it("reserves decline for the confirmed consent boundary", () => {
    const readout = interpretJevShadowResponse(response({ consent_violation: 0.9 }))
    expect(readout.recommendation).toBe("decline")
    expect(primaryJevShadowRisk(readout)).toBe("consent_violation")
  })

  it("distinguishes insufficient evidence from integrity risks", () => {
    const readout = interpretJevShadowResponse(
      response({ evidence_sufficiency: "insufficient" }),
    )
    expect(primaryJevShadowRisk(readout)).toBe("insufficient_evidence")
  })

  it("calls the endpoint without logging or persisting evidence", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST")
      expect(init?.headers).toMatchObject({ authorization: "Bearer test-key" })
      return new Response(JSON.stringify(response()), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof fetch

    const result = await evaluateJevShadow({
      apiKey: "test-key",
      state: { applicantEvidence: ["Synthetic evidence"], neutralMissingInformation: [] },
      fetchImpl,
    })
    expect(result.response.model).toBe(JEV_SHADOW_MODEL)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("supports OpenRouter's Decisions endpoint and pinned Jev model", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(OPENROUTER_JEV_SHADOW_ENDPOINT)
      const body = JSON.parse(String(init?.body)) as { model?: string }
      expect(body.model).toBe(OPENROUTER_JEV_SHADOW_MODEL)
      return new Response(JSON.stringify({
        ...response(),
        model: "typesafe/jev-1.13-20260917",
        provider: "TypeSafe",
      }), { status: 200, headers: { "content-type": "application/json" } })
    }) as unknown as typeof fetch

    const result = await evaluateJevShadow({
      apiKey: "openrouter-test-key",
      endpoint: OPENROUTER_JEV_SHADOW_ENDPOINT,
      model: OPENROUTER_JEV_SHADOW_MODEL,
      state: { applicantEvidence: ["Synthetic evidence"], neutralMissingInformation: [] },
      fetchImpl,
    })
    expect(result.response.provider).toBe("TypeSafe")
  })

  it("fails closed on missing credentials or malformed answers", async () => {
    await expect(
      evaluateJevShadow({
        apiKey: "",
        state: { applicantEvidence: [], neutralMissingInformation: [] },
      }),
    ).rejects.toThrow("TYPESAFE_API_KEY")
    const malformed = response()
    delete malformed.answers.specificity
    expect(() => interpretJevShadowResponse(malformed)).toThrow("specificity")
  })
})
