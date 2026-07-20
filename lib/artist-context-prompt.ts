import type { ArtistContext } from "@/lib/artist-context-enrichment"

export function buildArtistContextPromptAppendix(context: ArtistContext): string {
  const lines = [
    "The applicant named:",
    context.query,
    "",
    "Known context:",
    context.summary,
  ]

  if (context.genres?.length) {
    lines.push("", "Genres / styles:", ...context.genres.map((genre) => `- ${genre}`))
  }

  if (context.culturalNotes?.length) {
    lines.push(
      "",
      "Cultural notes:",
      ...context.culturalNotes.map((note) => `- ${note}`),
    )
  }

  lines.push(
    "",
    `Confidence: ${context.confidence}`,
    "",
    "Use this only to ask one sharper follow-up about why this artist matters to them personally.",
    "Do not treat artist verification as pass/fail criteria.",
    "If context is unknown or uncertain, continue naturally and ask about personal connection anyway.",
  )

  return `\n\n---\n\nAPPLICANT ARTIST CONTEXT\n\n${lines.join("\n")}`
}
