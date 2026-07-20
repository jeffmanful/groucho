import { describe, expect, it } from "vitest"
import { serializeInteractionInput } from "../react/serialize-interaction-input.js"

describe("serializeInteractionInput", () => {
  it("returns plain text for text input", () => {
    expect(serializeInteractionInput("text", "  hello  ")).toBe("hello")
  })

  it("returns selected option for single select", () => {
    expect(serializeInteractionInput("singleSelect", "Feedback")).toBe("Feedback")
  })

  it("serializes multi select as Selected: list", () => {
    expect(serializeInteractionInput("multiSelect", ["Feedback", "Community"])).toBe(
      "Selected: Feedback, Community",
    )
  })

  it("returns empty string for empty multi select", () => {
    expect(serializeInteractionInput("multiSelect", [])).toBe("")
  })
})
