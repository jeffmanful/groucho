import { DEFAULT_LOW_COST_ANTHROPIC_MODEL } from "@/lib/llm-usage"

export const DEFAULT_GATEKEEPER_CONVERSATION_MODEL =
  DEFAULT_LOW_COST_ANTHROPIC_MODEL

export function gatekeeperConversationModel(
  configuredModel: string | undefined =
    process.env.GROUCHO_GATEKEEPER_CONVERSATION_MODEL,
): string {
  return configuredModel?.trim() || DEFAULT_GATEKEEPER_CONVERSATION_MODEL
}
