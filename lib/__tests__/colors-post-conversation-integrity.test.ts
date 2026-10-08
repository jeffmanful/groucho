import { beforeEach, describe, expect, it, vi } from "vitest"

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))
vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = { create: createMock }
  },
}))

import { auditColorsConversationIntegrity } from "@/lib/colors-post-conversation"

function response(observations: unknown[], processMessageIds: string[] = []) {
  return {
    content: [{ type: "text", text: JSON.stringify({ observations, process_message_ids: processMessageIds }) }],
    stop_reason: "end_turn",
    usage: {},
  }
}

describe("post-conversation integrity audit", () => {
  beforeEach(() => createMock.mockReset())

  it("drops a fabricated-admission label on a commercial disclosure while retaining extractive intent", async () => {
    const disclosure = "I have paid placements in my guide, and I would link clients in the Forum."
    createMock.mockResolvedValueOnce(response([
      { kind: "admitted_fabrication", source_message_id: "second", quote: disclosure },
      { kind: "extractive_access_intent", source_message_id: "second", quote: "I would link clients in the Forum" },
    ]))
    const result = await auditColorsConversationIntegrity({
      forumMembershipPilot: true,
      messages: [
        { id: "first", role: "user", content: "I publish a city music guide." },
        { id: "second", role: "user", content: disclosure },
      ],
    })
    expect(result.concerns.map((concern) => concern.kind)).toEqual(["extractive_access_intent"])
    expect(String(createMock.mock.calls[0]?.[0]?.system)).toContain("explicitly retract an earlier statement")
  })

  it("keeps a source-linked explicit correction of an earlier applicant claim", async () => {
    const correction = "I said I run a group, but that was not true."
    createMock.mockResolvedValueOnce(response([
      { kind: "admitted_fabrication", source_message_id: "second", quote: correction },
    ]))
    const result = await auditColorsConversationIntegrity({
      messages: [
        { id: "first", role: "user", content: "I run a group." },
        { id: "second", role: "user", content: correction },
      ],
    })
    expect(result.concerns).toMatchObject([{ kind: "admitted_fabrication", sourceMessageId: "second" }])
  })

  it("does not call a first answer a correction of an earlier applicant claim", async () => {
    createMock.mockResolvedValueOnce(response([
      { kind: "admitted_fabrication", source_message_id: "first", quote: "I made that up." },
    ]))
    const result = await auditColorsConversationIntegrity({
      messages: [{ id: "first", role: "user", content: "I made that up." }],
    })
    expect(result.concerns).toEqual([])
  })

  it("keeps a mixed joining answer and Forum question for the thin pilot evidence pass", async () => {
    createMock.mockResolvedValueOnce(response([], ["mixed-answer"]))
    const result = await auditColorsConversationIntegrity({
      forumMembershipPilot: true,
      messages: [{
        id: "mixed-answer", role: "user",
        content: "I want a space that feels more tapped in. Is this something the Forum can provide?",
      }],
    })
    expect(result.processMessageIds).toEqual([])
  })
})
