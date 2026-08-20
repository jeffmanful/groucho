import type { ApplicationAnswerAssessment } from "@/lib/application-conversation-depth"

export type ApplicationIntegrityConcernKind =
  | "admitted_fabrication"
  | "artist_consent_violation"
  | "extractive_access_intent"

export type ApplicationIntegrityConcern = {
  kind: ApplicationIntegrityConcernKind
  reason: string
  reviewerFlag: string
}

export type CalibratedIntegrityStatus = "redirected" | "rejected"

export const COLORS_INTEGRITY_CALIBRATION: Record<
  ApplicationIntegrityConcernKind,
  CalibratedIntegrityStatus
> = {
  admitted_fabrication: "redirected",
  extractive_access_intent: "redirected",
  artist_consent_violation: "rejected",
}

type IntegrityConcernMessage = {
  role: "user" | "assistant"
  metadata?: unknown
}

const DEFINITIONS: Record<
  ApplicationIntegrityConcernKind,
  Omit<ApplicationIntegrityConcern, "kind">
> = {
  admitted_fabrication: {
    reason: "The applicant explicitly says an earlier participation claim was not true.",
    reviewerFlag: "Applicant explicitly disclosed fabricating an earlier participation claim.",
  },
  artist_consent_violation: {
    reason: "The applicant describes sharing private or unreleased artist work without permission.",
    reviewerFlag: "Applicant described sharing private or unreleased artist work without the artist's permission.",
  },
  extractive_access_intent: {
    reason: "The applicant frames community access primarily as growth or privileged access for their own platform.",
    reviewerFlag: "Applicant framed Forum access primarily as a way to obtain privileged artist access or grow their own platform.",
  },
}

function concern(kind: ApplicationIntegrityConcernKind): ApplicationIntegrityConcern {
  return { kind, ...DEFINITIONS[kind] }
}

export function detectApplicationIntegrityConcerns(
  answer: string,
): ApplicationIntegrityConcern[] {
  const value = answer.trim().toLowerCase().replace(/[’]/g, "'")
  const detected: ApplicationIntegrityConcern[] = []

  if (
    /\b(?:said|claimed?)\b.{0,100}\b(?:not true|wasn't true|was not true|not actually|made (?:it|that) up|because it sounded like what you wanted|improve my chances)\b/.test(value) ||
    /\b(?:that|it) was not true\b/.test(value)
  ) {
    detected.push(concern("admitted_fabrication"))
  }

  if (
    /\b(?:post|share|upload|publish|repost|circulate)\w*\b.{0,120}\b(?:without (?:asking|permission|consent)|even if (?:they|the artist) (?:are|is|were|was) hesitant)\b/.test(value) ||
    /\b(?:private|unreleased) (?:demo|track|song|recording|work)\b.{0,120}\b(?:exposure|without (?:asking|permission|consent))\b/.test(value)
  ) {
    detected.push(concern("artist_consent_violation"))
  }

  if (
    /\b(?:direct|early|privileged) access\b.{0,120}\b(?:grow|growth|platform|audience|contacts?)\b/.test(value) ||
    /\b(?:grow|growth)\b.{0,100}\b(?:my|our) (?:platform|audience|channel)\b.{0,120}\b(?:access|artists?|contacts?)\b/.test(value) ||
    /\bmember (?:list|network)\b.{0,120}\b(?:talent|channel|reach|platform)\b/.test(value)
  ) {
    detected.push(concern("extractive_access_intent"))
  }

  return detected
}

export function assessmentWithIntegrityConcerns(
  assessment: ApplicationAnswerAssessment | null,
  concerns: ApplicationIntegrityConcern[],
): ApplicationAnswerAssessment | null {
  if (concerns.length === 0) return assessment
  return {
    quality: "concerning",
    reason: concerns.map((item) => item.reason).join(" ").slice(0, 280),
    evidence: assessment?.evidence ?? {
      personalPointOfView: false,
      concreteDetail: true,
      emotionalConnection: false,
      independentJudgment: false,
      careOrContext: false,
    },
  }
}

export function applicationIntegrityChallengeQuestion(
  concerns: ApplicationIntegrityConcern[],
): string {
  const kinds = new Set(concerns.map((item) => item.kind))
  if (kinds.has("artist_consent_violation")) {
    return "If an artist shared that work privately, their permission matters. What would you do if they did not want it posted?"
  }
  if (kinds.has("admitted_fabrication")) {
    return "You've corrected something you said earlier. What is true about how you actually take part around music?"
  }
  return "You're describing the Forum mainly as access for your own platform. What would you give back without using someone else's work or relationships for your own reach?"
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function collectApplicationIntegrityConcerns(
  messages: IntegrityConcernMessage[],
): ApplicationIntegrityConcern[] {
  const concerns = messages.flatMap((message) => {
    if (message.role !== "user") return []
    const raw = record(message.metadata)?.application_integrity_concerns
    if (!Array.isArray(raw)) return []
    return raw.flatMap((item) => {
      const kind = record(item)?.kind
      return typeof kind === "string" && kind in DEFINITIONS
        ? [concern(kind as ApplicationIntegrityConcernKind)]
        : []
    })
  })
  return [...new Map(concerns.map((item) => [item.kind, item])).values()]
}

/**
 * Applies the first client-labelled boundary set. A first current concern gets
 * a calm challenge; repeated concerns resolve, and admitted fabrication keeps
 * any later terminal proposal in human review.
 */
export function calibratedStatusForIntegrityHistory(input: {
  stored: ApplicationIntegrityConcern[]
  current: ApplicationIntegrityConcern[]
  terminalProposed: boolean
}): CalibratedIntegrityStatus | null {
  const storedKinds = new Set(input.stored.map((item) => item.kind))
  const repeated = input.current.find((item) => storedKinds.has(item.kind))
  if (repeated) return COLORS_INTEGRITY_CALIBRATION[repeated.kind]
  if (
    input.terminalProposed &&
    storedKinds.has("admitted_fabrication")
  ) {
    return "redirected"
  }
  return null
}
