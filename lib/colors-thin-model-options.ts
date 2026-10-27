// Client-safe: no imports, so the demo page can render the same list the server accepts.
/**
 * Models a tester may pick for the newer COLORS engine in the demo. Requests naming any other
 * model fall back to the configured default, so the browser can never select an arbitrary model.
 */
export const COLORS_THIN_CONVERSATION_MODEL_OPTIONS = [
  { id: "claude-haiku-5-5", label: "Haiku 5.5", note: "Default. Fast and low cost." },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", note: "Fast. Previous default." },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", note: "Slower replies, about 3 to 5 seconds." },
] as const

export type ColorsThinConversationModelId = (typeof COLORS_THIN_CONVERSATION_MODEL_OPTIONS)[number]["id"]

export function selectableColorsThinModel(value: unknown): ColorsThinConversationModelId | undefined {
  return COLORS_THIN_CONVERSATION_MODEL_OPTIONS.find((option) => option.id === value)?.id
}
