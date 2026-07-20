export const DEFAULT_GATEKEEPER_CONVERSATION_MODEL =
  "claude-haiku-4-5-20251001"

export function gatekeeperConversationModel(
  configuredModel: string | undefined =
    process.env.GROUCHO_GATEKEEPER_CONVERSATION_MODEL,
): string {
  return configuredModel?.trim() || DEFAULT_GATEKEEPER_CONVERSATION_MODEL
}
