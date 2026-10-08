import { describe, expect, it } from "vitest"
import {
  colorsInteractionCatalog,
  resolveApplicationRichInteraction,
} from "@/lib/application-rich-interaction"

const shows = [
  { videoId: "abc123xyz01", title: "Artist One - Song | A COLORS SHOW", artist: "Artist One" },
  { videoId: "abc123xyz02", title: "Artist Two - Song | A COLORS SHOW", artist: "Artist Two" },
  { videoId: "abc123xyz03", title: "Artist Three - Song | A COLORS SHOW", artist: "Artist Three" },
]

describe("approved rich application interactions", () => {
  it("exposes titles and opaque IDs, not URLs, to the model", () => {
    expect(colorsInteractionCatalog(shows)[0]).toEqual({
      id: "yt_abc123xyz01",
      title: "Artist One - Song",
      artist: "Artist One",
      availableFormats: ["videoChoice", "imageReference", "linkReference"],
    })
  })

  it("resolves an image or link reference to a server-approved URL", () => {
    const image = resolveApplicationRichInteraction({
      kind: "reference",
      format: "image",
      assetIds: ["yt_abc123xyz01"],
      question: "What might this performance invite other listeners to discuss?",
      purpose: "Explore community conversation",
    }, shows)
    expect(image).toMatchObject({
      kind: "reference",
      cards: [{
        kind: "image",
        url: "https://www.youtube.com/watch?v=abc123xyz01",
        imageUrl: "https://i.ytimg.com/vi/abc123xyz01/hqdefault.jpg",
      }],
    })
    const link = resolveApplicationRichInteraction({
      kind: "reference",
      format: "link",
      assetIds: ["yt_abc123xyz02"],
      question: "What would you want to hear from people after sharing this performance?",
      purpose: "Explore artist engagement",
    }, shows)
    expect(link).toMatchObject({ kind: "reference", cards: [{ kind: "link" }] })
    expect(link && link.kind === "reference" && link.cards[0].imageUrl).toBeUndefined()
  })

  it("lets the model shape a video choice without trusting asset URLs or counts", () => {
    const choice = resolveApplicationRichInteraction({
      kind: "choice",
      format: "video",
      assetIds: ["yt_abc123xyz01", "yt_abc123xyz02", "yt_abc123xyz03"],
      mode: "select",
      question: "Which performance would you bring into a first Forum conversation?",
      rationalePrompt: "What would you ask the other members about it?",
      purpose: "Explore a discussion-starter choice",
    }, shows)
    expect(choice).toMatchObject({
      kind: "choice",
      interaction: {
        selection: { mode: "select", minSelections: 1, maxSelections: 1 },
        rationale: { prompt: "What would you ask the other members about it?" },
      },
    })
  })

  it("rejects invented IDs, repeated assets, raw links in questions, and malformed proposals", () => {
    const base = {
      kind: "reference",
      format: "link",
      assetIds: ["yt_abc123xyz01"],
      question: "What would you ask other listeners about this performance?",
      purpose: "Explore discussion",
    }
    expect(resolveApplicationRichInteraction({ ...base, assetIds: ["yt_notapproved"] }, shows)).toBeNull()
    expect(resolveApplicationRichInteraction({ ...base, assetIds: [base.assetIds[0], base.assetIds[0]] }, shows)).toBeNull()
    expect(resolveApplicationRichInteraction({ ...base, question: "Read https://example.com and reply?" }, shows)).toBeNull()
    expect(resolveApplicationRichInteraction({ ...base, question: "A statement." }, shows)).toBeNull()
  })
})
