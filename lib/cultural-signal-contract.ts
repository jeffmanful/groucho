export const CULTURAL_SIGNAL_TYPES = [
  "artist_reference",
  "creative_discipline",
  "scene_or_genre",
  "participation_style",
  "community_care",
  "artist_sustainability",
  "discovery_and_curation",
  "feedback_and_criticism",
  "ai_and_authorship",
  "access_or_exposure",
  "emerging_theme",
] as const

export type CulturalSignalType = (typeof CULTURAL_SIGNAL_TYPES)[number]

export type CulturalSignal = {
  type: CulturalSignalType
  normalizedKey: string
  displayLabel: string
  confidence: number
  isSensitive: boolean
}

export type CulturalSignalsSettings = {
  enabled: boolean
  windowDays: number
  minimumSessions: number
  sensitiveMinimumSessions: number
  conversationUseEnabled: false
}

export type CulturalSignalAggregate = {
  type: CulturalSignalType
  normalizedKey: string
  displayLabel: string
  distinctSessions: number
  frequencyBand: "emerging" | "recurring" | "strong"
  trend: "new" | "rising" | "stable" | "falling"
  isSensitive: boolean
}

export type CulturalSignalSnapshot = {
  version: number
  generatedAt: string
  windowDays: number
  eligibleSessionCount: number
  signals: CulturalSignalAggregate[]
  pendingEmergingSignals: CulturalSignalAggregate[]
}

export const DEFAULT_CULTURAL_SIGNALS_SETTINGS: CulturalSignalsSettings = {
  enabled: false,
  windowDays: 90,
  minimumSessions: 5,
  sensitiveMinimumSessions: 10,
  conversationUseEnabled: false,
}

const TYPE_SET = new Set<string>(CULTURAL_SIGNAL_TYPES)
const SENSITIVE_TYPES = new Set<CulturalSignalType>(["community_care"])
const FIXED_LABELS: Partial<Record<CulturalSignalType, string>> = {
  participation_style: "Participation style",
  community_care: "Community care",
  artist_sustainability: "Artist sustainability",
  discovery_and_curation: "Discovery and curation",
  feedback_and_criticism: "Feedback and criticism",
  ai_and_authorship: "AI and authorship",
  access_or_exposure: "Access or exposure",
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

export function parseCulturalSignalsSettings(settings: unknown): CulturalSignalsSettings {
  const raw = record(record(settings)?.cultural_signals)
  if (!raw) return { ...DEFAULT_CULTURAL_SIGNALS_SETTINGS }
  const minimumSessions = clampInteger(raw.minimum_sessions, 5, 5, 100)
  return {
    enabled: raw.enabled === true,
    windowDays: clampInteger(raw.window_days, 90, 1, 365),
    minimumSessions,
    sensitiveMinimumSessions: Math.max(
      minimumSessions,
      clampInteger(raw.sensitive_minimum_sessions, 10, 10, 200),
    ),
    // This cannot be enabled through project settings during the internal phase.
    conversationUseEnabled: false,
  }
}

export function serializeCulturalSignalsSettings(enabled: boolean): Record<string, unknown> {
  return {
    enabled,
    window_days: 90,
    minimum_sessions: 5,
    sensitive_minimum_sessions: 10,
    conversation_use_enabled: false,
  }
}

function safeLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const value = raw.trim().replace(/\s+/g, " ").slice(0, 80)
  return value && value.split(" ").length <= 8 ? value : null
}

function normalizeKey(label: string): string {
  return label.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80)
}

export function normaliseCulturalSignals(raw: unknown): CulturalSignal[] {
  if (!Array.isArray(raw)) return []
  const unique = new Map<string, CulturalSignal>()
  for (const item of raw.slice(0, 8)) {
    const value = record(item)
    if (!value || typeof value.type !== "string" || !TYPE_SET.has(value.type)) continue
    const type = value.type as CulturalSignalType
    const displayLabel = FIXED_LABELS[type] ?? safeLabel(value.displayLabel)
    if (!displayLabel) continue
    const normalizedKey = FIXED_LABELS[type] ? type : normalizeKey(displayLabel)
    const confidence = typeof value.confidence === "number" && Number.isFinite(value.confidence)
      ? Math.max(0, Math.min(1, value.confidence)) : 0.5
    if (!normalizedKey || confidence < 0.6) continue
    unique.set(`${type}:${normalizedKey}`, {
      type, normalizedKey, displayLabel, confidence, isSensitive: SENSITIVE_TYPES.has(type),
    })
  }
  return [...unique.values()]
}

export function culturalSignalsFromMessageMetadata(metadata: unknown): CulturalSignal[] {
  return normaliseCulturalSignals(record(metadata)?.cultural_signals)
}

export type CulturalSignalEvent = {
  session_id: string
  signal_type: CulturalSignalType
  normalized_key: string
  display_label: string
  is_sensitive: boolean
  created_at: string
}

function frequencyBand(count: number, minimum: number): CulturalSignalAggregate["frequencyBand"] {
  if (count >= minimum * 3) return "strong"
  if (count >= minimum * 2) return "recurring"
  return "emerging"
}

function trend(recent: number, previous: number): CulturalSignalAggregate["trend"] {
  if (previous === 0) return "new"
  if (recent >= previous * 1.35) return "rising"
  if (recent <= previous * 0.65) return "falling"
  return "stable"
}

export function aggregateCulturalSignalEvents(input: {
  events: CulturalSignalEvent[]
  approvedEmergingKeys: Set<string>
  pendingEmergingKeys: Set<string>
  minimumSessions: number
  sensitiveMinimumSessions: number
  now?: Date
}) {
  const now = input.now ?? new Date()
  const recentBoundary = now.getTime() - 30 * 86400000
  const previousBoundary = now.getTime() - 60 * 86400000
  const groups = new Map<string, {
    type: CulturalSignalType; normalizedKey: string; displayLabel: string; isSensitive: boolean
    sessions: Set<string>; recent: Set<string>; previous: Set<string>
  }>()
  for (const event of input.events) {
    const key = `${event.signal_type}:${event.normalized_key}`
    const group = groups.get(key) ?? {
      type: event.signal_type, normalizedKey: event.normalized_key,
      displayLabel: event.display_label, isSensitive: event.is_sensitive,
      sessions: new Set<string>(), recent: new Set<string>(), previous: new Set<string>(),
    }
    group.sessions.add(event.session_id)
    const time = new Date(event.created_at).getTime()
    if (time >= recentBoundary) group.recent.add(event.session_id)
    else if (time >= previousBoundary) group.previous.add(event.session_id)
    groups.set(key, group)
  }
  const signals: CulturalSignalAggregate[] = []
  const pendingEmergingSignals: CulturalSignalAggregate[] = []
  for (const group of groups.values()) {
    const threshold = group.isSensitive ? input.sensitiveMinimumSessions : input.minimumSessions
    if (group.sessions.size < threshold) continue
    const item: CulturalSignalAggregate = {
      type: group.type, normalizedKey: group.normalizedKey, displayLabel: group.displayLabel,
      distinctSessions: group.sessions.size, frequencyBand: frequencyBand(group.sessions.size, threshold),
      trend: trend(group.recent.size, group.previous.size), isSensitive: group.isSensitive,
    }
    if (group.type !== "emerging_theme" || input.approvedEmergingKeys.has(group.normalizedKey)) signals.push(item)
    else if (input.pendingEmergingKeys.has(group.normalizedKey)) pendingEmergingSignals.push(item)
  }
  const sort = (a: CulturalSignalAggregate, b: CulturalSignalAggregate) =>
    b.distinctSessions - a.distinctSessions || a.displayLabel.localeCompare(b.displayLabel)
  return {
    eligibleSessionCount: new Set(input.events.map((event) => event.session_id)).size,
    signals: signals.sort(sort), pendingEmergingSignals: pendingEmergingSignals.sort(sort),
  }
}
