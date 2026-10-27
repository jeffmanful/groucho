import { describe, expect, it } from "vitest"
import {
  colorsThinConversationModel,
  DEFAULT_COLORS_THIN_CONVERSATION_MODEL,
  DEFAULT_GATEKEEPER_CONVERSATION_MODEL,
  gatekeeperConversationModel,
  supportsForcedToolChoice,
} from "@/lib/gatekeeper-models"
import { COLORS_THIN_CONVERSATION_MODEL_OPTIONS, selectableColorsThinModel } from "@/lib/colors-thin-model-options"

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

describe("colorsThinConversationModel", () => {
  it("defaults the newer COLORS engine to Haiku 5.5", () => {
    expect(colorsThinConversationModel(undefined, undefined)).toBe(DEFAULT_COLORS_THIN_CONVERSATION_MODEL)
    expect(DEFAULT_COLORS_THIN_CONVERSATION_MODEL).toBe("claude-haiku-5-5")
  })

  it("prefers the engine override, then the shared gatekeeper override", () => {
    expect(colorsThinConversationModel(" claude-sonnet-5-5 ", "claude-haiku-4-5-20251001")).toBe("claude-sonnet-5-5")
    expect(colorsThinConversationModel(undefined, "claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5-20251001")
    expect(colorsThinConversationModel("  ", undefined)).toBe("claude-haiku-5-5")
  })
})

describe("tester-selectable COLORS conversation models", () => {
  it("accepts only listed models, defaulting to Haiku 5.5 first", () => {
    expect(COLORS_THIN_CONVERSATION_MODEL_OPTIONS[0].id).toBe("claude-haiku-5-5")
    expect(selectableColorsThinModel("claude-sonnet-5-5")).toBe("claude-sonnet-5-5")
    expect(selectableColorsThinModel("claude-opus-5-5")).toBeUndefined()
    expect(selectableColorsThinModel(undefined)).toBeUndefined()
    expect(selectableColorsThinModel({ id: "claude-haiku-5-5" })).toBeUndefined()
  })

  it("knows which models need structured output instead of a forced tool", () => {
    expect(supportsForcedToolChoice("claude-haiku-5-5")).toBe(true)
    expect(supportsForcedToolChoice("claude-haiku-4-5-20251001")).toBe(true)
    expect(supportsForcedToolChoice("claude-sonnet-5-5")).toBe(false)
  })
})
