import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = { create: (...args: unknown[]) => mocks.anthropicCreate(...args) }
  },
}))

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      upsert: (...args: unknown[]) => mocks.upsert(table, ...args),
    }),
  },
}))

import {
  extractCompletedSessionCulturalSignals,
  recordCompletedSessionCulturalSignals,
} from "@/lib/cultural-signals"

function anthropicResponse(signals: unknown[]) {
  return {
    content: [{ type: "text", text: JSON.stringify({ signals }) }],
    stop_reason: "end_turn",
    usage: {},
  }
}

describe("background cultural-signal extraction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.upsert.mockResolvedValue({ error: null })
  })

  it("keeps only normalised signals tied to supplied applicant message ids", async () => {
    mocks.anthropicCreate.mockResolvedValue(
      anthropicResponse([
        {
          sourceMessageId: "user_1",
          type: "artist_reference",
          displayLabel: "Kelela",
          confidence: 0.92,
        },
        {
          sourceMessageId: "unknown",
          type: "scene_or_genre",
          displayLabel: "Ambient",
          confidence: 0.9,
        },
        {
          sourceMessageId: "user_1",
          type: "creative_discipline",
          displayLabel: "Dance",
          confidence: 0.2,
        },
      ]),
    )

    const result = await extractCompletedSessionCulturalSignals({
      organisationId: "org_1",
      projectId: "project_1",
      sessionId: "session_1",
      messages: [
        { id: "assistant_1", role: "assistant", content: "Who do you listen to?" },
        { id: "user_1", role: "user", content: "Kelela." },
      ],
    })

    expect(result).toEqual([
      {
        sourceMessageId: "user_1",
        signal: expect.objectContaining({
          type: "artist_reference",
          normalizedKey: "kelela",
          displayLabel: "Kelela",
        }),
      },
    ])
    expect(mocks.anthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 768,
        output_config: {
          format: {
            type: "json_schema",
            schema: expect.objectContaining({ type: "object" }),
          },
        },
      }),
    )
  })

  it("preserves legacy metadata signals and extracts only untagged messages", async () => {
    mocks.anthropicCreate.mockResolvedValue(
      anthropicResponse([
        {
          sourceMessageId: "user_2",
          type: "participation_style",
          displayLabel: "Listening circles",
          confidence: 0.88,
        },
      ]),
    )

    await recordCompletedSessionCulturalSignals({
      organisationId: "org_1",
      projectId: "project_1",
      sessionId: "session_1",
      settings: { cultural_signals: { enabled: true } },
      likelyBot: false,
      messages: [
        {
          id: "user_1",
          role: "user",
          content: "Kelela is a reference.",
          metadata: {
            cultural_signals: [
              {
                type: "artist_reference",
                displayLabel: "Kelela",
                confidence: 0.9,
              },
            ],
          },
        },
        {
          id: "user_2",
          role: "user",
          content: "I host listening circles.",
        },
      ],
    })

    const request = mocks.anthropicCreate.mock.calls[0]?.[0] as {
      messages: Array<{ content: string }>
    }
    expect(request.messages[0]?.content).not.toContain("Kelela is a reference")
    expect(request.messages[0]?.content).toContain("I host listening circles")
    expect(mocks.upsert).toHaveBeenCalledWith(
      "cultural_signal_events",
      expect.arrayContaining([
        expect.objectContaining({
          source_message_id: "user_1",
          signal_type: "artist_reference",
          normalized_key: "kelela",
        }),
        expect.objectContaining({
          source_message_id: "user_2",
          signal_type: "participation_style",
          normalized_key: "participation_style",
        }),
      ]),
      { onConflict: "source_message_id,signal_type,normalized_key", ignoreDuplicates: true },
    )
  })

  it("does no extraction or persistence when collection is disabled", async () => {
    await recordCompletedSessionCulturalSignals({
      organisationId: "org_1",
      projectId: "project_1",
      sessionId: "session_1",
      settings: {},
      likelyBot: false,
      messages: [{ id: "user_1", role: "user", content: "Kelela." }],
    })

    expect(mocks.anthropicCreate).not.toHaveBeenCalled()
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
})
