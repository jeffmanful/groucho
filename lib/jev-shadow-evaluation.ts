import type { AdvisoryRecommendation } from "@/lib/reviewer-report"

export const JEV_SHADOW_MODEL = "jev-1.13.0"
export const JEV_SHADOW_ENDPOINT = "https://api.typesafe.ai/v1/systemone"
export const OPENROUTER_JEV_SHADOW_MODEL = "typesafe/jev-1.13"
export const OPENROUTER_JEV_SHADOW_ENDPOINT =
  "https://openrouter.ai/api/alpha/decisions"

export type JevQuestion =
  | { type: "noul"; instructions: string; criteria: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] }

export type JevChoiceAnswer = {
  type: "choice"
  choice: string
  probabilities: Record<string, number>
  confidence: number
}

export type JevScoreAnswer = {
  type: "score"
  score: number
  legend: Record<string, string>
  probabilities: Record<string, number>
  confidence: number
}

export type JevNoulAnswer = { type: "noul"; noul: number }
export type JevAnswer = JevChoiceAnswer | JevScoreAnswer | JevNoulAnswer

export type JevSystemOneResponse = {
  model: string
  answers: Record<string, JevAnswer>
  usage: { input_tokens: number; output_tokens: number; cost?: number }
  id?: string
  provider?: string
}

export type JevShadowState = {
  applicantEvidence: readonly string[]
  neutralMissingInformation: readonly string[]
}

const FOUR_LEVEL_SCORE = {
  specificity: [
    "No concrete evidence; only empty or generic assertions",
    "One partly concrete detail, but most claims remain general",
    "Several concrete details grounded in actual habits, intentions, or examples",
    "Consistently specific evidence with clear examples and consequences",
  ],
  reciprocity: [
    "Primarily seeks access, attention, or personal gain without returning value",
    "Mentions community but gives little evidence of reciprocal participation",
    "Describes a plausible two-way exchange or contribution",
    "Shows sustained, concrete care for contributing to other members as well as receiving value",
  ],
  cultural_depth: [
    "No meaningful cultural judgment or point of view",
    "Names interests but gives little context or personal judgment",
    "Explains preferences, context, or creative judgment with care",
    "Demonstrates nuanced cultural judgment, context, and awareness of other people",
  ],
  contribution: [
    "No plausible contribution or participation pattern",
    "A vague intention to participate without a concrete behavior",
    "A realistic, specific contribution or repeatable participation behavior",
    "An already demonstrated contribution pattern with a realistic way to sustain it here",
  ],
} as const

export const JEV_SHADOW_QUESTIONS = {
  specificity: {
    type: "score",
    instructions: "Rate how specific and evidence-grounded the applicant's statements are. Do not reward fluency, fame, credentials, audience size, or professional status.",
    criteria: [...FOUR_LEVEL_SCORE.specificity],
  },
  reciprocity: {
    type: "score",
    instructions: "Rate the applicant's demonstrated reciprocity: whether they intend to contribute attention, care, participation, or useful action rather than only extract value.",
    criteria: [...FOUR_LEVEL_SCORE.reciprocity],
  },
  cultural_depth: {
    type: "score",
    instructions: "Rate the depth of cultural judgment explicitly present in the evidence. Do not use missing credentials, popularity, or polished writing as negative evidence.",
    criteria: [...FOUR_LEVEL_SCORE.cultural_depth],
  },
  contribution: {
    type: "score",
    instructions: "Rate how concrete and plausible the applicant's participation or contribution is, based only on what is explicitly stated.",
    criteria: [...FOUR_LEVEL_SCORE.contribution],
  },
  evidence_sufficiency: {
    type: "choice",
    instructions: "How much usable evidence is present for a community-fit review? Treat `neutralMissingInformation` as deliberately neutral and never as a weakness.",
    criteria: {
      insufficient: "The evidence remains too vague or incomplete to support a recommendation",
      mixed: "There is some usable evidence, but important uncertainty remains",
      sufficient: "There is enough concrete evidence to support a recommendation",
    },
  },
  orientation: {
    type: "choice",
    instructions: "Which participation orientation is explicitly best supported? Choose hybrid only when two or more distinct participation modes are supported. Choose unknown when none is supported.",
    criteria: {
      artist: "Makes or develops their own creative work",
      curator: "Selects, contextualises, organises, facilitates, or connects creative work and people",
      enthusiast: "Participates primarily through attentive listening, discovery, discussion, or support",
      hybrid: "Explicitly demonstrates at least two of artist, curator, and enthusiast participation",
      unknown: "The evidence does not establish a participation orientation",
    },
  },
  admitted_fabrication: {
    type: "noul",
    instructions: "Does the applicant explicitly admit inventing or materially misrepresenting a participation claim to improve their chances?",
    criteria: {
      true: "There is an explicit admission of fabrication or material misrepresentation",
      false: "There is no explicit admission; uncertainty or missing evidence alone is not fabrication",
    },
  },
  repeated_extractive_intent: {
    type: "noul",
    instructions: "Does the evidence repeatedly frame the community mainly as access to people, work, or attention for the applicant's own platform, without reciprocal intent?",
    criteria: {
      true: "Repeated primarily extractive intent is explicit",
      false: "Reciprocal intent is present, or extractive intent is not explicit and repeated",
    },
  },
  consent_violation: {
    type: "noul",
    instructions: "Does the applicant explicitly say they share private creative work without permission and would continue after the creator objects?",
    criteria: {
      true: "Both non-consensual sharing and intent to continue after objection are explicit",
      false: "Either condition is absent or unclear",
    },
  },
} as const satisfies Record<string, JevQuestion>

export type JevShadowReadout = {
  recommendation: AdvisoryRecommendation
  orientation: string
  composite: number
  dimensions: Record<"specificity" | "reciprocity" | "cultural_depth" | "contribution", number>
  sufficiency: string
  sufficiencyConfidence: number
  risks: Record<"admitted_fabrication" | "repeated_extractive_intent" | "consent_violation", number>
}

export type JevShadowRisk =
  | "none"
  | "insufficient_evidence"
  | "fabrication"
  | "extractive_intent"
  | "consent_violation"

export function primaryJevShadowRisk(readout: JevShadowReadout): JevShadowRisk {
  if (readout.risks.consent_violation >= 0.75) return "consent_violation"
  if (readout.risks.admitted_fabrication >= 0.75) return "fabrication"
  if (readout.risks.repeated_extractive_intent >= 0.75) return "extractive_intent"
  if (readout.sufficiency === "insufficient" && readout.sufficiencyConfidence >= 0.5) {
    return "insufficient_evidence"
  }
  return "none"
}

function assertProbability(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Invalid Jev probability for ${label}`)
  }
  return value
}

function choiceAnswer(answers: Record<string, JevAnswer>, key: string): JevChoiceAnswer {
  const answer = answers[key]
  if (!answer || answer.type !== "choice" || typeof answer.choice !== "string") {
    throw new Error(`Missing Jev choice answer: ${key}`)
  }
  assertProbability(answer.confidence, `${key}.confidence`)
  return answer
}

function noulAnswer(answers: Record<string, JevAnswer>, key: string): number {
  const answer = answers[key]
  if (!answer || answer.type !== "noul") throw new Error(`Missing Jev noul answer: ${key}`)
  return assertProbability(answer.noul, key)
}

function normalizedScore(answers: Record<string, JevAnswer>, key: string): number {
  const answer = answers[key]
  if (!answer || answer.type !== "score" || !Number.isFinite(answer.score)) {
    throw new Error(`Missing Jev score answer: ${key}`)
  }
  assertProbability(answer.confidence, `${key}.confidence`)
  const levelCount = Object.keys(answer.legend).length
  if (levelCount < 2) throw new Error(`Invalid Jev score legend: ${key}`)
  return Math.max(0, Math.min(1, answer.score / (levelCount - 1)))
}

export function interpretJevShadowResponse(response: JevSystemOneResponse): JevShadowReadout {
  const dimensions = {
    specificity: normalizedScore(response.answers, "specificity"),
    reciprocity: normalizedScore(response.answers, "reciprocity"),
    cultural_depth: normalizedScore(response.answers, "cultural_depth"),
    contribution: normalizedScore(response.answers, "contribution"),
  }
  const composite = Object.values(dimensions).reduce((sum, value) => sum + value, 0) / 4
  const sufficiency = choiceAnswer(response.answers, "evidence_sufficiency")
  const orientation = choiceAnswer(response.answers, "orientation")
  const risks = {
    admitted_fabrication: noulAnswer(response.answers, "admitted_fabrication"),
    repeated_extractive_intent: noulAnswer(response.answers, "repeated_extractive_intent"),
    consent_violation: noulAnswer(response.answers, "consent_violation"),
  }

  let recommendation: AdvisoryRecommendation = "human_review"
  if (risks.consent_violation >= 0.75) recommendation = "decline"
  else if (
    risks.admitted_fabrication < 0.75 &&
    risks.repeated_extractive_intent < 0.75 &&
    sufficiency.choice === "sufficient" &&
    sufficiency.confidence >= 0.5 &&
    composite >= 0.55
  ) {
    recommendation = "recommend"
  }

  return {
    recommendation,
    orientation: orientation.choice,
    composite,
    dimensions,
    sufficiency: sufficiency.choice,
    sufficiencyConfidence: sufficiency.confidence,
    risks,
  }
}

export function buildJevShadowRequest(state: JevShadowState, model = JEV_SHADOW_MODEL) {
  return {
    model,
    state,
    questions: JEV_SHADOW_QUESTIONS,
  }
}

export async function evaluateJevSystemOne(input: {
  apiKey: string
  state: unknown
  questions: Record<string, JevQuestion>
  fetchImpl?: typeof fetch
  endpoint?: string
  model?: string
  timeoutMs?: number
}): Promise<{ response: JevSystemOneResponse; latencyMs: number }> {
  if (!input.apiKey.trim()) throw new Error("TYPESAFE_API_KEY is required")
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 15_000)
  const started = performance.now()
  try {
    const response = await (input.fetchImpl ?? fetch)(input.endpoint ?? JEV_SHADOW_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.model ?? JEV_SHADOW_MODEL,
        state: input.state,
        questions: input.questions,
      }),
      signal: controller.signal,
    })
    const data = await response.json() as unknown
    if (!response.ok) throw new Error(`TypeSafe API returned ${response.status}`)
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("TypeSafe API returned an invalid response")
    }
    const value = data as Partial<JevSystemOneResponse>
    if (typeof value.model !== "string" || !value.answers || !value.usage) {
      throw new Error("TypeSafe API response is missing required fields")
    }
    return {
      response: value as JevSystemOneResponse,
      latencyMs: Math.round((performance.now() - started) * 10) / 10,
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function evaluateJevShadow(input: {
  apiKey: string
  state: JevShadowState
  fetchImpl?: typeof fetch
  endpoint?: string
  model?: string
  timeoutMs?: number
}): Promise<{ response: JevSystemOneResponse; latencyMs: number }> {
  return evaluateJevSystemOne({
    ...input,
    questions: JEV_SHADOW_QUESTIONS,
  })
}
