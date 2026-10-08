import type { ApplicationAnswerAssessment } from "@/lib/application-conversation-depth"

export type ApplicationIntegrityConcernKind =
  | "admitted_fabrication"
  | "artist_consent_violation"
  | "artist_consent_unestablished"
  | "extractive_access_intent"

export type ApplicationIntegrityConcern = {
  kind: ApplicationIntegrityConcernKind
  reason: string
  reviewerFlag: string
  sourceMessageId?: string
  quote?: string
}

export type CalibratedIntegrityStatus = "redirected" | "rejected"

export const COLORS_INTEGRITY_CALIBRATION: Record<
  ApplicationIntegrityConcernKind,
  CalibratedIntegrityStatus
> = {
  admitted_fabrication: "redirected",
  extractive_access_intent: "redirected",
  artist_consent_violation: "rejected",
  artist_consent_unestablished: "redirected",
}

type IntegrityConcernMessage = {
  role: "user" | "assistant"
  id?: string
  content?: string
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
    reason: "The applicant explicitly disregards artist permission when discussing sharing their work.",
    reviewerFlag: "Applicant explicitly described sharing, or intending to share, artist work without permission; distinguish intention from completed conduct in the transcript.",
  },
  artist_consent_unestablished: {
    reason: "The applicant proposes sharing unreleased artist work but has not said whether the artist agreed.",
    reviewerFlag: "",
  },
  extractive_access_intent: {
    reason: "The applicant frames community access primarily as growth or privileged access for their own platform.",
    reviewerFlag: "Applicant primarily framed Forum access as a way to promote their own clients or platform.",
  },
}

function concern(kind: ApplicationIntegrityConcernKind): ApplicationIntegrityConcern {
  return { kind, ...DEFINITIONS[kind] }
}

/** A semantic concern must point at the applicant's actual words. */
export function sourceLinkedApplicationIntegrityConcern(
  raw: unknown,
  answer: string,
  sourceMessageId: string,
): ApplicationIntegrityConcern | null {
  const value = record(raw)
  const kind = value?.kind
  const quote = typeof value?.quote === "string" ? value.quote.trim() : ""
  if (typeof kind !== "string" || !(kind in DEFINITIONS) ||
    quote.length < 8 || !answer.includes(quote)) return null
  // This only resolves an inconsistent model label on an already source-linked
  // observation; it does not discover concerns by searching the transcript.
  const resolvedKind = kind === "artist_consent_unestablished" &&
    /\b(?:without permission|without asking|don't always ask|not planning to ask)\b/i.test(quote)
    ? "artist_consent_violation"
    : kind as ApplicationIntegrityConcernKind
  return {
    ...concern(resolvedKind),
    sourceMessageId,
    quote: quote.slice(0, 240),
  }
}

export function sourceLinkedConsentResolution(
  raw: unknown,
  answer: string,
  sourceMessageId: string,
): { kind: "artist_consent_confirmed"; quote: string; sourceMessageId: string } | null {
  const value = record(raw)
  const quote = typeof value?.quote === "string" ? value.quote.trim() : ""
  return value?.kind === "artist_consent_confirmed" &&
    quote.length >= 8 && answer.includes(quote)
    ? { kind: "artist_consent_confirmed", quote: quote.slice(0, 240), sourceMessageId }
    : null
}

/**
 * Conservative lexical candidate detection for one explicit client boundary.
 * This is not a general semantic judge: it deliberately requires the action,
 * artist work, and denied consent to occur in the same sentence, and it treats
 * negated actions as safe. The live model still supplies context and the pilot
 * keeps the resulting recommendation advisory.
 */
function explicitlySharesArtistWorkWithoutConsent(answer: string): boolean {
  return answer.split(/[.!?;\n]+/).some((sentence) => {
    const action = /\b(?:post|share|upload|publish|repost|circulate)\w*\b/g
    const artistWork = /\b(?:private|unreleased|unfinished)\s+(?:demos?|tracks?|songs?|recordings?|work)\b/
    const deniedConsent = /\b(?:without (?:asking|permission|consent)|even if (?:they|the artist) (?:are|is|were|was) hesitant)\b/
    if (!artistWork.test(sentence) || !deniedConsent.test(sentence)) return false
    for (const match of sentence.matchAll(action)) {
      const before = sentence.slice(Math.max(0, match.index - 32), match.index)
      if (/\b(?:do not|don't|would not|wouldn't|will not|won't|never|not)\s*$/.test(before)) {
        continue
      }
      return true
    }
    return false
  })
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

  if (explicitlySharesArtistWorkWithoutConsent(value)) {
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
    return "The artist's permission matters here. What would you do if they did not want that work posted?"
  }
  if (kinds.has("artist_consent_unestablished")) {
    return "Before you share that work publicly, has the artist said you can?"
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
  const concerns: ApplicationIntegrityConcern[] = []
  for (const message of messages) {
    if (message.role !== "user") continue
    const resolution = record(record(message.metadata)?.application_integrity_resolution)
    if (resolution?.kind === "artist_consent_confirmed" &&
      typeof resolution.quote === "string" &&
      (typeof message.content !== "string" || message.content.includes(resolution.quote))) {
      for (let index = concerns.length - 1; index >= 0; index -= 1) {
        if (concerns[index].kind === "artist_consent_unestablished") concerns.splice(index, 1)
      }
    }
    const raw = record(message.metadata)?.application_integrity_concerns
    if (!Array.isArray(raw)) continue
    concerns.push(...raw.flatMap((item) => {
      const value = record(item)
      const kind = value?.kind
      return typeof kind === "string" && kind in DEFINITIONS
        ? [{
            ...concern(kind as ApplicationIntegrityConcernKind),
            ...(typeof value?.quote === "string" &&
              (typeof message.content !== "string" || message.content.includes(value.quote))
              ? { quote: value.quote.slice(0, 240) }
              : {}),
            ...(typeof value?.sourceMessageId === "string" &&
              (!message.id || value.sourceMessageId === message.id)
              ? { sourceMessageId: value.sourceMessageId }
              : {}),
          }]
        : []
    }))
  }
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
