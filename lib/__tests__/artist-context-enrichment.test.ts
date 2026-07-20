import { describe, expect, it, vi, beforeEach } from "vitest"

let anthropicCreateImpl: (args: unknown) => Promise<unknown> = async () => ({
  content: [{ type: "text", text: "{}" }],
})

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class Anthropic {
      messages = {
        create: (args: unknown) => anthropicCreateImpl(args),
      }
    },
  }
})

describe("enrichArtistContext", () => {
  beforeEach(() => {
    anthropicCreateImpl = async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            summary: "British singer and producer known for experimental pop.",
            genres: ["art pop", "electronic"],
            culturalNotes: ["Visual performance-led work"],
            confidence: "high",
          }),
        },
      ],
    })
  })

  it("returns normalized artist context", async () => {
    const { enrichArtistContext } = await import("@/lib/artist-context-enrichment")
    const result = await enrichArtistContext("FKA twigs")
    expect(result).toEqual({
      query: "FKA twigs",
      summary: "British singer and producer known for experimental pop.",
      genres: ["art pop", "electronic"],
      culturalNotes: ["Visual performance-led work"],
      confidence: "high",
    })
  })

  it("returns null on invalid json", async () => {
    anthropicCreateImpl = async () => ({
      content: [{ type: "text", text: "not json" }],
    })
    const { enrichArtistContext } = await import("@/lib/artist-context-enrichment")
    expect(await enrichArtistContext("Unknown Artist XYZ")).toBeNull()
  })

  it("returns null on llm failure", async () => {
    anthropicCreateImpl = async () => {
      throw new Error("boom")
    }
    const { enrichArtistContext } = await import("@/lib/artist-context-enrichment")
    expect(await enrichArtistContext("Arca")).toBeNull()
  })
})

describe("normaliseArtistContext", () => {
  it("requires a summary", async () => {
    const { normaliseArtistContext } = await import("@/lib/artist-context-enrichment")
    expect(normaliseArtistContext("Arca", { confidence: "unknown" })).toBeNull()
  })
})
