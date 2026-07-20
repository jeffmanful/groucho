import { describe, expect, it } from "vitest"
import {
  parseOpeningInteraction,
  parseOpeningMessage,
  resolveGatekeeperOpeningInteraction,
  resolveGatekeeperOpeningMessage,
} from "@/lib/opening-message"
import { DEFAULT_APPLICATION_OPENING_MESSAGE } from "@/lib/project-settings"

describe("parseOpeningMessage", () => {
  it("accepts undefined", () => {
    expect(parseOpeningMessage(undefined)).toEqual({ ok: true, value: undefined })
  })

  it("rejects empty strings", () => {
    expect(parseOpeningMessage("   ").ok).toBe(false)
  })

  it("rejects overly long strings", () => {
    expect(parseOpeningMessage("x".repeat(501)).ok).toBe(false)
  })

  it("trims valid strings", () => {
    expect(parseOpeningMessage("  Hello there.  ")).toEqual({
      ok: true,
      value: "Hello there.",
    })
  })
})

describe("resolveGatekeeperOpeningMessage", () => {
  it("prefers client opener over project default", () => {
    expect(
      resolveGatekeeperOpeningMessage(
        "Welcome to COLORS.",
        DEFAULT_APPLICATION_OPENING_MESSAGE,
      ),
    ).toBe("Welcome to COLORS.")
  })

  it("falls back to project opener", () => {
    expect(
      resolveGatekeeperOpeningMessage(undefined, "Project opener."),
    ).toBe("Project opener.")
  })
})

describe("resolveGatekeeperOpeningInteraction", () => {
  it("prefers client interaction over project config", () => {
    expect(
      resolveGatekeeperOpeningInteraction(
        {
          intent: "probe",
          inputType: "multiSelect",
          emotionalState: "neutral",
          visualState: "curious",
          options: ["A", "B"],
        },
        {
          inputType: "singleSelect",
          options: ["Artist"],
        },
      ).inputType,
    ).toBe("multiSelect")
  })

  it("falls back to project opening interaction", () => {
    expect(
      resolveGatekeeperOpeningInteraction(undefined, {
        inputType: "singleSelect",
        options: ["Artist", "Curator"],
      }),
    ).toEqual({
      intent: "probe",
      inputType: "singleSelect",
      emotionalState: "neutral",
      visualState: "curious",
      options: ["Artist", "Curator"],
    })
  })
})

describe("parseOpeningInteraction", () => {
  it("accepts undefined", () => {
    expect(parseOpeningInteraction(undefined)).toEqual({
      ok: true,
      value: undefined,
    })
  })

  it("accepts text input", () => {
    const result = parseOpeningInteraction({ inputType: "text" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value?.inputType).toBe("text")
  })

  it("accepts single select with options", () => {
    const result = parseOpeningInteraction({
      inputType: "singleSelect",
      options: ["Artist", "Curator"],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value?.inputType).toBe("singleSelect")
      expect(result.value?.options).toEqual(["Artist", "Curator"])
    }
  })

  it("rejects structured input without options", () => {
    expect(parseOpeningInteraction({ inputType: "multiSelect" }).ok).toBe(false)
  })
})
