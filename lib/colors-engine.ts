/** Marks sessions run by the newer COLORS conversation engine (stored on message metadata). */
export const COLORS_THIN_PILOT_MARKER = "colors_thin_pilot_v1"

/** True when any message of a session was written by the newer COLORS engine. */
export function isColorsThinSession(messages: Array<{ metadata: unknown }>): boolean {
  return messages.some((message) => {
    const metadata = message.metadata
    return Boolean(metadata) && typeof metadata === "object" && !Array.isArray(metadata) &&
      (metadata as Record<string, unknown>).conversation_engine === COLORS_THIN_PILOT_MARKER
  })
}

/** A direct applicant question must receive a live reply before the session can close. */
export function applicantAsksQuestion(message: string): boolean {
  const question = message.replace(/(?:,?\s*\b(?:you know|right|you see|you get me|know what I mean))\?\s*$/i, "").trim()
  return question.includes("?") ||
    /(?:^|[.!]\s+)(?:(?:is|are|can|could|would|will|do|does|did|should|may|might|have|has)\b|(?:what|how|why|where|when|who)\s+(?:is|are|was|were|do|does|did|can|could|would|will|should|have|has)\b)/i.test(question)
}

/** Project setting value that routes a gatekeeper project to the newer COLORS engine. */
export const COLORS_ENGINE_SETTING = "colors_forum"

/** `settings.conversation_engine === "colors_forum"` on the project's stored settings. */
export function projectUsesColorsEngine(rawSettings: unknown): boolean {
  return Boolean(rawSettings) && typeof rawSettings === "object" && !Array.isArray(rawSettings) &&
    (rawSettings as Record<string, unknown>).conversation_engine === COLORS_ENGINE_SETTING
}
