import { describe, expect, it } from "vitest"
import { buildArtistContextPromptAppendix } from "@/lib/artist-context-prompt"

describe("buildArtistContextPromptAppendix", () => {
  it("formats artist context for the gatekeeper prompt", () => {
    const appendix = buildArtistContextPromptAppendix({
      query: "FKA twigs",
      summary: "British singer, producer, and performer known for experimental pop.",
      genres: ["art pop", "electronic"],
      culturalNotes: ["Known for intimate, visual live performances"],
      confidence: "high",
    })

    expect(appendix).toContain("APPLICANT ARTIST CONTEXT")
    expect(appendix).toContain("FKA twigs")
    expect(appendix).toContain("art pop")
    expect(appendix).toContain("Do not treat artist verification as pass/fail criteria")
  })
})
