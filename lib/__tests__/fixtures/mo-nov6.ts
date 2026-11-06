/** Reproduction of the 6 November 2026 10:04 conversation, without session identifiers. */
export const brokenMoConversation = [
  { role: "assistant", content: "Alright, I'm Mo. What brought you to Lewisham Social?", metadata: { conversation_choice_key: "discovery" } },
  { role: "user", content: "Someone brought me along" },
  { role: "assistant", content: "How did you first hear about the band?", details: { discovery: "Someone brought me along" } },
  { role: "user", content: "A mate told me about them" },
  { role: "assistant", content: "What caught your ear?", details: { discovery: "Someone brought me along" } },
  { role: "user", content: "the raw vibes" },
  { role: "assistant", content: "What caught your ear?", details: { discovery: "Someone brought me along", connection: "Raw vibes" } },
  { role: "user", content: "the political sound" },
  { role: "assistant", content: "What caught your ear?", details: { discovery: "Someone brought me along", connection: "Raw vibes; the political sound" } },
  { role: "user", content: "the hook and lyrics" },
] as const

export function moHistoryBefore(index: number) {
  return brokenMoConversation.slice(0, index).map(entry => ({
    role: entry.role, content: entry.content,
    metadata: {
      conversation_engine: "groucho_conversation_v1", conversation_profile: "lewisham-social",
      ...("metadata" in entry ? entry.metadata : {}),
      ...("details" in entry ? { conversation_details: entry.details } : {}),
    } as Record<string, unknown>,
  }))
}
