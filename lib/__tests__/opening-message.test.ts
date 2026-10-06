import { describe, expect, it } from "vitest"
import {
  parseOpeningInteraction,
  parseOpeningMessage,
} from "@/lib/opening-message"

describe("parseOpeningMessage", () => {
  it("rejects empty strings", () => {
    expect(parseOpeningMessage("   ").ok).toBe(false)
  })

  it("rejects overly long strings", () => {
    expect(parseOpeningMessage("x".repeat(501)).ok).toBe(false)
  })
})

describe("parseOpeningInteraction", () => {
  it("rejects structured input without options", () => {
    expect(parseOpeningInteraction({ inputType: "multiSelect" }).ok).toBe(false)
  })

  it("rejects a media choice without a valid contract", () => {
    expect(
      parseOpeningInteraction({ inputType: "mediaChoice", mediaChoice: {} }).ok,
    ).toBe(false)
  })
})
