export const APPLICATION_PARTICIPANT_ORIENTATIONS = [
  "unknown",
  "artist",
  "curator",
  "enthusiast",
  "hybrid",
] as const

export type ApplicationParticipantOrientation =
  (typeof APPLICATION_PARTICIPANT_ORIENTATIONS)[number]

export type ApplicationParticipantOrientationState = {
  primary: ApplicationParticipantOrientation
  scores: {
    artist: number
    curator: number
    enthusiast: number
  }
  confidence: number
  evidence: string[]
}

export type ApplicationParticipantOrientationMessage = {
  role: "user" | "assistant"
  metadata?: unknown
}

export const EMPTY_APPLICATION_PARTICIPANT_ORIENTATION: ApplicationParticipantOrientationState = {
  primary: "unknown",
  scores: { artist: 0, curator: 0, enthusiast: 0 },
  confidence: 0,
  evidence: [],
}

const MAX_EVIDENCE_ITEMS = 4

type RoutedOrientation = "artist" | "curator" | "enthusiast"

export function isExplicitCommunityIntent(value: string): boolean {
  return /^(?:(?:i(?:'m| am)?\s+)?(?:here\s+)?for\s+(?:the\s+)?community|community)[.!]?$/i.test(
    value.trim(),
  )
}

function explicitOrientationEvidence(value: string): Set<RoutedOrientation> {
  const answer = value.trim().toLowerCase()
  const evidence = new Set<RoutedOrientation>()
  if (/\b(i make|i write|i produce|i sing|i rap|i dj|my music|my songs?|my tracks?|share work|(?:i(?:'ve| have) (?:only )?been|i(?:'m| am)) making (?:my own )?(?:music|songs?|tracks?)|i(?:'m| am) (?!not\b)[^.!?]{0,40}\b(?:artist|musician|producer|singer|rapper|dj)|as an? (?:artist|musician|producer|singer|rapper|dj)|i work as an? (?:artist|musician|producer|singer|rapper|dj))\b/.test(answer)) {
    evidence.add("artist")
  }
  if (/\b(curat|organis|organiz|host|run a|book|programme|program|label|promoter|connect people|community manager|introduc(?:e|ed|ing) (?:two |independent |local )?artists?)\w*/.test(answer)) {
    evidence.add("curator")
  }
  if (
    /\b(mostly listen|listener|music fan|colors fan|colours fan|discover|find(?:ing)? new music|enthusiast|like discussing music|discuss music)\b/.test(
      answer,
    ) || isExplicitCommunityIntent(value)
  ) {
    evidence.add("enthusiast")
  }
  return evidence
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function score(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0
}

function evidenceItems(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().replace(/\s+/g, " ").slice(0, 160))
    .filter(Boolean)
    .slice(0, MAX_EVIDENCE_ITEMS)
}

function resolvePrimary(scores: ApplicationParticipantOrientationState["scores"]): {
  primary: ApplicationParticipantOrientation
  confidence: number
} {
  const ranked = (Object.entries(scores) as Array<
    ["artist" | "curator" | "enthusiast", number]
  >).sort((a, b) => b[1] - a[1])
  const [first, second] = ranked
  if (!first || first[1] < 0.45) return { primary: "unknown", confidence: first?.[1] ?? 0 }
  if (second && second[1] >= 0.5 && first[1] - second[1] <= 0.15) {
    return { primary: "hybrid", confidence: Math.min(first[1], second[1]) }
  }
  return { primary: first[0], confidence: first[1] }
}

export function normaliseApplicationParticipantOrientation(
  value: unknown,
): ApplicationParticipantOrientationState {
  const raw = record(value)
  const rawScores = record(raw?.scores) ?? raw
  if (!rawScores) return EMPTY_APPLICATION_PARTICIPANT_ORIENTATION
  const scores = {
    artist: score(rawScores.artist),
    curator: score(rawScores.curator),
    enthusiast: score(rawScores.enthusiast),
  }
  const resolved = resolvePrimary(scores)
  return {
    ...resolved,
    scores,
    evidence: evidenceItems(raw?.evidence),
  }
}

export function collectApplicationParticipantOrientation(
  messages: ApplicationParticipantOrientationMessage[],
): ApplicationParticipantOrientationState {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== "assistant") continue
    const orientation = record(message.metadata)?.participant_orientation
    if (orientation) return normaliseApplicationParticipantOrientation(orientation)
  }
  return EMPTY_APPLICATION_PARTICIPANT_ORIENTATION
}

export function inferApplicationParticipantOrientation(input: {
  previous?: ApplicationParticipantOrientationState
  currentAnswer: string
}): ApplicationParticipantOrientationState {
  const previous = input.previous ?? EMPTY_APPLICATION_PARTICIPANT_ORIENTATION
  const answer = input.currentAnswer.trim().toLowerCase()
  const scores = { ...previous.scores }
  const evidence = [...previous.evidence]
  const addEvidence = (item: string) => {
    if (!evidence.includes(item)) evidence.push(item)
  }

  const explicitEvidence = explicitOrientationEvidence(input.currentAnswer)

  if (explicitEvidence.has("artist")) {
    scores.artist = Math.max(scores.artist, 0.82)
    addEvidence("Describes making or performing creative work")
  }
  if (explicitEvidence.has("curator")) {
    scores.curator = Math.max(scores.curator, 0.82)
    addEvidence("Describes curating, organising, or connecting people around music")
  }
  if (/\b(mostly listen|listener|music fan|colors fan|colours fan|discover|find(?:ing)? new music|enthusiast)\b/.test(answer)) {
    scores.enthusiast = Math.max(scores.enthusiast, 0.82)
    addEvidence("Describes listening or discovery as their main relationship to music")
  }
  if (isExplicitCommunityIntent(input.currentAnswer)) {
    scores.enthusiast = Math.max(scores.enthusiast, 0.72)
    addEvidence("Names community as their reason for being here")
  }
  if (/\b(like discussing music|discuss music)\b/.test(answer)) {
    scores.enthusiast = Math.max(scores.enthusiast, 0.72)
    addEvidence("Describes discussion as part of their relationship to music")
  }
  if (/\b(enjoy giving feedback|regularly share discoveries)\b/.test(answer)) {
    scores.curator = Math.max(scores.curator, 0.62)
    addEvidence("Describes active feedback or music-sharing participation")
  }

  const resolved = resolvePrimary(scores)
  return {
    ...resolved,
    scores,
    evidence: evidence.slice(-MAX_EVIDENCE_ITEMS),
  }
}

export function mergeApplicationParticipantOrientation(input: {
  previous: ApplicationParticipantOrientationState
  proposed: ApplicationParticipantOrientationState
  currentAnswer: string
}): ApplicationParticipantOrientationState {
  const inferred = inferApplicationParticipantOrientation({
    previous: input.previous,
    currentAnswer: input.currentAnswer,
  })
  const explicitEvidence = explicitOrientationEvidence(input.currentAnswer)
  const proposedEntries = Object.entries(input.proposed.scores) as Array<
    [RoutedOrientation, number]
  >
  const proposedPrimary = proposedEntries.sort((a, b) => b[1] - a[1])[0]?.[0]
  const acceptProposedScore = (orientation: RoutedOrientation): boolean => {
    if (explicitEvidence.has(orientation)) return true
    if (input.previous.primary === orientation) return true
    if (input.previous.scores[orientation] >= 0.5) return true
    return input.previous.primary === "unknown" && proposedPrimary === orientation
  }
  return normaliseApplicationParticipantOrientation({
    scores: {
      artist: Math.max(
        inferred.scores.artist,
        acceptProposedScore("artist") ? input.proposed.scores.artist : 0,
      ),
      curator: Math.max(
        inferred.scores.curator,
        acceptProposedScore("curator") ? input.proposed.scores.curator : 0,
      ),
      enthusiast: Math.max(
        inferred.scores.enthusiast,
        acceptProposedScore("enthusiast")
          ? input.proposed.scores.enthusiast
          : 0,
      ),
    },
    evidence: [
      ...inferred.evidence,
      ...input.proposed.evidence,
    ].slice(-MAX_EVIDENCE_ITEMS),
  })
}

export function orientationHasCuratorRoute(
  orientation: ApplicationParticipantOrientationState,
): boolean {
  return orientation.primary === "curator" || orientation.scores.curator >= 0.5
}
