import type Anthropic from "@anthropic-ai/sdk"

/** Tool name must stay stable — referenced in system suffix and parsers. */
export const GATEKEEPER_RESPONSE_TOOL_NAME = "groucho_respond" as const

export type GatekeeperTerminalField = "none" | "pass" | "redirect" | "reject"

export const gatekeeperResponseTool = {
  name: GATEKEEPER_RESPONSE_TOOL_NAME,
  description:
    "Required every turn. `reply` is what the applicant reads. `terminal` ends the session when not `none`.",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description:
          "User-visible assistant message (keep within the persona’s length and tone rules).",
      },
      terminal: {
        type: "string",
        enum: ["none", "pass", "redirect", "reject"],
        description:
          "`none` while the conversation continues. `pass`, `redirect`, or `reject` when this turn concludes the session (semantic judgment follows the system persona).",
      },
    },
    required: ["reply", "terminal"],
  },
} as const satisfies Anthropic.Tool

/**
 * Appended after persona + outcome appendix so Claude always sees tool contract.
 * (Persona text may describe *when* to set each `terminal` value.)
 */
export const GATEKEEPER_STRUCTURED_SYSTEM_SUFFIX = `---

TECHNICAL — Groucho runtime (non-negotiable)

Every assistant turn you MUST call the tool \`${GATEKEEPER_RESPONSE_TOOL_NAME}\` exactly once.
- \`reply\`: string shown to the applicant.
- \`terminal\`: one of \`none\` | \`pass\` | \`redirect\` | \`reject\`. Use \`none\` until you intentionally end the session.

Do not emit a plain assistant text reply only; the tool call is required.`

export type ParsedGatekeeperStructured = {
  reply: string
  /** Resolved terminal when the model used the tool; otherwise \`null\`. */
  terminal: GatekeeperTerminalField | null
  toolSeen: boolean
}

function normaliseTerminal(raw: unknown): GatekeeperTerminalField | null {
  if (raw === "none" || raw === "pass" || raw === "redirect" || raw === "reject")
    return raw
  return null
}

export function parseGatekeeperStructuredResponse(
  content: Anthropic.ContentBlock[],
): ParsedGatekeeperStructured {
  const textParts: string[] = []
  let reply = ""
  let terminal: GatekeeperTerminalField | null = null
  let toolSeen = false

  for (const b of content) {
    if (b.type === "text") textParts.push(b.text)
    if (b.type === "tool_use" && b.name === GATEKEEPER_RESPONSE_TOOL_NAME) {
      toolSeen = true
      const input = b.input as Record<string, unknown>
      terminal = normaliseTerminal(input.terminal)
      const r = input.reply
      if (typeof r === "string") reply = r.trim()
    }
  }

  if (!reply) reply = textParts.join("\n").trim()
  if (toolSeen && terminal === null) terminal = "none"

  return { reply, terminal: toolSeen ? terminal : null, toolSeen }
}
