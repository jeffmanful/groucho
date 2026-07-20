import { describe, expect, it } from "vitest"
import {
  DEFAULT_GATEKEEPER_CONVERSATION_MODEL,
  gatekeeperConversationModel,
} from "@/lib/gatekeeper-models"

describe("gatekeeperConversationModel", () => {
  it("defaults conversational turns to the pinned Haiku model", () => {
    expect(gatekeeperConversationModel(undefined)).toBe(
      DEFAULT_GATEKEEPER_CONVERSATION_MODEL,
    )
    expect(DEFAULT_GATEKEEPER_CONVERSATION_MODEL).toBe(
      "claude-haiku-4-5-20251001",
    )
  })

  it("accepts a server-side model override", () => {
    expect(
      gatekeeperConversationModel(" claude-sonnet-5 "),
    ).toBe("claude-sonnet-5")
  })
})
