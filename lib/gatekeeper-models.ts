import { DEFAULT_LOW_COST_ANTHROPIC_MODEL } from "@/lib/llm-usage"

export const DEFAULT_GATEKEEPER_CONVERSATION_MODEL =
  DEFAULT_LOW_COST_ANTHROPIC_MODEL

export function gatekeeperConversationModel(
  configuredModel: string | undefined =
    process.env.GROUCHO_GATEKEEPER_CONVERSATION_MODEL,
): string {
  return configuredModel?.trim() || DEFAULT_GATEKEEPER_CONVERSATION_MODEL
}

/**
 * The newer COLORS conversation engine was calibrated on Haiku 5.5 with its tighter prompt
 * (docs/replays/*tighter-prompt*). The standard engine keeps the low-cost default above.
 * Precedence: engine-specific override, then the shared gatekeeper override, then this default.
 */
export const DEFAULT_COLORS_THIN_CONVERSATION_MODEL = "claude-haiku-5-5"

export function colorsThinConversationModel(
  engineModel: string | undefined = process.env.GROUCHO_COLORS_THIN_CONVERSATION_MODEL,
  sharedModel: string | undefined = process.env.GROUCHO_GATEKEEPER_CONVERSATION_MODEL,
): string {
  return engineModel?.trim() || sharedModel?.trim() || DEFAULT_COLORS_THIN_CONVERSATION_MODEL
}

/**
 * Some newer models reject a forced tool choice. For those the conversation engine asks for
 * schema-constrained JSON output instead, which returns the same fields.
 */
export function supportsForcedToolChoice(model: string): boolean {
  return !/^claude-sonnet-5(?:-|$)/.test(model)
}
