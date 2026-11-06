/** Grounded conversational notes. Corrections remain explicit rather than being
 * folded into a visitor profile or confused with someone else's experience. */
export type ConversationMemory = {
  subject: "visitor" | "other" | "correction" | "thread"
  detail: string
  sourceQuote: string
}

export function conversationMemory(raw: unknown, answer?: string): ConversationMemory[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap(item => {
    if (!item || typeof item !== "object") return []
    const { subject, detail, sourceQuote } = item
    if (!["visitor", "other", "correction", "thread"].includes(subject) ||
      typeof detail !== "string" || !detail.trim() || detail.length > 600 ||
      typeof sourceQuote !== "string" || !sourceQuote.trim() ||
      answer !== undefined && !answer.toLowerCase().includes(sourceQuote.toLowerCase())) return []
    return [{ subject, detail: detail.trim(), sourceQuote: sourceQuote.trim() } as ConversationMemory]
  })
}

export function mergeConversationMemory(previous: unknown, updates: unknown, answer: string): ConversationMemory[] {
  return Array.from(new Map([...conversationMemory(previous), ...conversationMemory(updates, answer)]
    .map(note => [`${note.subject}:${note.detail}`, note])).values())
}
