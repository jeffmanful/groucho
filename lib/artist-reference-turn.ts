const ARTIST_QUESTION_RE =
  /\b(artist|musician|band|producer|dj|rapper|singer|songwriter)\b|whose work|name an artist|creative reference|music.*care about|artist.*(influence|reference|matter)/i

const MAX_ARTIST_ANSWER_LENGTH = 120

export function isArtistReferenceQuestion(assistantMessage: string): boolean {
  const text = assistantMessage.trim()
  if (!text) return false
  return ARTIST_QUESTION_RE.test(text)
}

export function looksLikeArtistNameAnswer(userMessage: string): boolean {
  const text = userMessage.trim()
  if (!text || text.length > MAX_ARTIST_ANSWER_LENGTH) return false

  const sentenceCount = (text.match(/[.!?]+/g) ?? []).length
  if (sentenceCount > 1) return false

  const lineCount = text.split("\n").filter((line) => line.trim()).length
  if (lineCount > 2) return false

  return true
}

export function shouldEnrichArtistReference(
  previousAssistantMessage: string,
  userMessage: string,
): boolean {
  return (
    isArtistReferenceQuestion(previousAssistantMessage) &&
    looksLikeArtistNameAnswer(userMessage)
  )
}

export function previousAssistantMessage(
  history: Array<{ role: "user" | "assistant"; content: string }>,
): string | null {
  if (history.length < 2) return null
  const last = history[history.length - 1]
  if (last.role !== "user") return null

  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i].role === "assistant") return history[i].content
  }
  return null
}
