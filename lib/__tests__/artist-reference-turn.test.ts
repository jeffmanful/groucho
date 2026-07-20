import { describe, expect, it } from "vitest"
import {
  isArtistReferenceQuestion,
  looksLikeArtistNameAnswer,
  previousAssistantMessage,
  shouldEnrichArtistReference,
} from "@/lib/artist-reference-turn"

describe("isArtistReferenceQuestion", () => {
  it("matches artist reference prompts", () => {
    expect(
      isArtistReferenceQuestion(
        "Name an artist whose work feels closest to what you care about.",
      ),
    ).toBe(true)
    expect(
      isArtistReferenceQuestion("What musician has influenced you most?"),
    ).toBe(true)
  })

  it("does not match unrelated prompts", () => {
    expect(
      isArtistReferenceQuestion("What would you protect in this community?"),
    ).toBe(false)
  })
})

describe("looksLikeArtistNameAnswer", () => {
  it("accepts short artist names", () => {
    expect(looksLikeArtistNameAnswer("FKA twigs")).toBe(true)
    expect(looksLikeArtistNameAnswer("Arca")).toBe(true)
  })

  it("rejects long essay answers", () => {
    expect(
      looksLikeArtistNameAnswer(
        "I think FKA twigs matters because her work changed how I see performance and intimacy in electronic music over the last decade.",
      ),
    ).toBe(false)
  })
})

describe("shouldEnrichArtistReference", () => {
  it("requires both an artist question and a short answer", () => {
    expect(
      shouldEnrichArtistReference(
        "Name an artist whose work feels closest to what you care about.",
        "FKA twigs",
      ),
    ).toBe(true)
    expect(
      shouldEnrichArtistReference(
        "What would you protect in this community?",
        "FKA twigs",
      ),
    ).toBe(false)
  })
})

describe("previousAssistantMessage", () => {
  it("returns the assistant message before the latest user reply", () => {
    expect(
      previousAssistantMessage([
        { role: "assistant", content: "Hi." },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Name an artist." },
        { role: "user", content: "Arca" },
      ]),
    ).toBe("Name an artist.")
  })
})
