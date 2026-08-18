import { describe, expect, it } from "vitest"
import {
  aggregateCulturalSignalEvents,
  normaliseCulturalSignals,
  parseCulturalSignalsSettings,
  serializeCulturalSignalsSettings,
  type CulturalSignalEvent,
} from "@/lib/cultural-signal-contract"

const now = new Date("2026-08-17T12:00:00.000Z")
function events(count: number, overrides: Partial<CulturalSignalEvent> = {}): CulturalSignalEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    session_id: `session-${index}`,
    signal_type: "artist_reference",
    normalized_key: "kelela",
    display_label: "Kelela",
    is_sensitive: false,
    created_at: "2026-08-10T12:00:00.000Z",
    ...overrides,
  }))
}

describe("cultural signal contract", () => {
  it("is opt-in and keeps conversation use locked off", () => {
    expect(parseCulturalSignalsSettings({}).enabled).toBe(false)
    expect(parseCulturalSignalsSettings({ cultural_signals: {
      enabled: true, conversation_use_enabled: true,
    }})).toMatchObject({ enabled: true, windowDays: 90, minimumSessions: 5,
      sensitiveMinimumSessions: 10, conversationUseEnabled: false })
    expect(serializeCulturalSignalsSettings(true).conversation_use_enabled).toBe(false)
  })

  it("normalises explicit short labels and rejects weak or overly specific output", () => {
    const result = normaliseCulturalSignals([
      { type: "artist_reference", displayLabel: " Kelela ", confidence: .9 },
      { type: "artist_reference", displayLabel: "Kelela", confidence: .8 },
      { type: "scene_or_genre", displayLabel: "a label containing far too many individual words to be safe", confidence: .9 },
      { type: "creative_discipline", displayLabel: "Dance", confidence: .3 },
      { type: "community_care", displayLabel: "anything", confidence: .8 },
    ])
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ normalizedKey: "kelela", displayLabel: "Kelela", isSensitive: false })
    expect(result[1]).toMatchObject({ normalizedKey: "community_care", displayLabel: "Community care", isSensitive: true })
  })

  it("counts distinct sessions and applies higher sensitive thresholds", () => {
    const aggregate = aggregateCulturalSignalEvents({
      events: [
        ...events(5),
        ...events(1, { session_id: "session-0" }),
        ...events(9, { signal_type: "community_care", normalized_key: "community_care", display_label: "Community care", is_sensitive: true }),
      ],
      approvedEmergingKeys: new Set(), pendingEmergingKeys: new Set(),
      minimumSessions: 5, sensitiveMinimumSessions: 10, now,
    })
    expect(aggregate.signals).toHaveLength(1)
    expect(aggregate.signals[0].distinctSessions).toBe(5)
    expect(JSON.stringify(aggregate)).not.toContain("response")
  })

  it("keeps emerging themes pending until approved", () => {
    const pending = aggregateCulturalSignalEvents({
      events: events(5, { signal_type: "emerging_theme", normalized_key: "slow_listening", display_label: "Slow listening" }),
      approvedEmergingKeys: new Set(), pendingEmergingKeys: new Set(["slow_listening"]),
      minimumSessions: 5, sensitiveMinimumSessions: 10, now,
    })
    expect(pending.signals).toHaveLength(0)
    expect(pending.pendingEmergingSignals).toHaveLength(1)
    const approved = aggregateCulturalSignalEvents({
      events: events(5, { signal_type: "emerging_theme", normalized_key: "slow_listening", display_label: "Slow listening" }),
      approvedEmergingKeys: new Set(["slow_listening"]), pendingEmergingKeys: new Set(),
      minimumSessions: 5, sensitiveMinimumSessions: 10, now,
    })
    expect(approved.signals).toHaveLength(1)
  })
})

