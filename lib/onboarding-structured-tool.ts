import type Anthropic from "@anthropic-ai/sdk"

export const ONBOARDING_RESPONSE_TOOL_NAME = "groucho_onboarding_turn" as const

export type OnboardingTurnAction = "continue" | "followup" | "boundary"

export const onboardingResponseTool = {
  name: ONBOARDING_RESPONSE_TOOL_NAME,
  description:
    "Required every turn. `reply` is what the user reads. `action` controls flow.",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description: "User-visible assistant message.",
      },
      action: {
        type: "string",
        enum: ["continue", "followup", "boundary"],
        description:
          "`continue` to advance after a good answer; `followup` for one clarifying question on the same step; `boundary` when the answer undermines dignity or safety.",
      },
    },
    required: ["reply", "action"],
  },
} as const satisfies Anthropic.Tool

export const ONBOARDING_STRUCTURED_SYSTEM_SUFFIX = `---

TECHNICAL — Groucho onboarding runtime (non-negotiable)

Every turn you MUST call the tool \`${ONBOARDING_RESPONSE_TOOL_NAME}\` exactly once.
- \`reply\`: string shown to the user (max 3 short sentences).
- \`action\`: \`continue\` | \`followup\` | \`boundary\`

When \`action\` is \`continue\`, your reply MUST end with the exact next question text provided in the user message (verbatim, including punctuation).

Do not emit a plain assistant text reply only; the tool call is required.`

export type ParsedOnboardingStructured = {
  reply: string
  action: OnboardingTurnAction | null
  toolSeen: boolean
}

function normaliseAction(raw: unknown): OnboardingTurnAction | null {
  if (raw === "continue" || raw === "followup" || raw === "boundary") return raw
  return null
}

export function parseOnboardingStructuredResponse(
  content: Anthropic.ContentBlock[],
): ParsedOnboardingStructured {
  const textParts: string[] = []
  let reply = ""
  let action: OnboardingTurnAction | null = null
  let toolSeen = false

  for (const b of content) {
    if (b.type === "text") textParts.push(b.text)
    if (b.type === "tool_use" && b.name === ONBOARDING_RESPONSE_TOOL_NAME) {
      toolSeen = true
      const input = b.input as Record<string, unknown>
      action = normaliseAction(input.action)
      const r = input.reply
      if (typeof r === "string") reply = r.trim()
    }
  }

  if (!reply) reply = textParts.join("\n").trim()
  if (toolSeen && action === null) action = "continue"

  return { reply, action, toolSeen }
}
