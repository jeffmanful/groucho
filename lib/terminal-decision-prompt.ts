/**
 * Semantic outcome guidance appended to persona system prompts. Actual
 * completion is enforced via the `groucho_respond` tool (see
 * `lib/gatekeeper-structured-tool.ts`); {@link canonicalTerminalDecision} remains
 * a fallback when the model omits the tool.
 */
export const TERMINAL_DECISION_MARKER =
  "Pass: respond with exactly — Yeah. Here." as const

/** Persona already includes v2 structured-outcome section — skip appending. */
export const STRUCTURED_SESSION_OUTCOME_MARKER =
  "SESSION OUTCOME (semantic)" as const

export const TERMINAL_DECISION_SYSTEM_APPENDIX = `---

SESSION OUTCOME (semantic)

The platform records your judgment via the required \`groucho_respond\` tool (\`terminal\` field). Do not rely on magic words in \`reply\`.

Use \`terminal\`:
- \`none\` — Still reading them; one question or observation in \`reply\`.
- \`pass\` — They belong: specific, personal, understands stakes; lived weight of loss, not performance.
- \`redirect\` — Genuine but not aligned for this space; abstract care, no skin in the game; not predatory.
- \`reject\` — Extractive, commodifying, access-as-the-point, marketing energy; their presence would harm the space.

\`reply\` is only what the applicant reads (follow persona length and tone). When you set \`terminal\` to something other than \`none\`, this is your final turn.`

/**
 * Appends {@link TERMINAL_DECISION_SYSTEM_APPENDIX} when the base prompt does
 * not already contain outcome instructions (legacy string block or v2 semantic
 * block).
 */
export function withTerminalDecisionAppendix(basePrompt: string): string {
  const t = basePrompt.trim()
  if (!t) return TERMINAL_DECISION_SYSTEM_APPENDIX.trim()
  if (
    t.includes(TERMINAL_DECISION_MARKER) ||
    t.includes(STRUCTURED_SESSION_OUTCOME_MARKER)
  ) {
    return t
  }
  return `${t}\n\n${TERMINAL_DECISION_SYSTEM_APPENDIX}`
}

function stripOuterNoise(s: string): string {
  let t = s.trim()
  if (!t) return t
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/m, "").trim()
  }
  return t.replace(/^[*_`"'“”‘']+|[*_`"'“”‘']+$/g, "").trim()
}

function matchDecisionLine(line: string): "Yeah. Here." | "REDIRECT" | "REJECTED" | null {
  const s = stripOuterNoise(line)
  if (!s) return null
  if (/^redirect\.?$/i.test(s)) return "REDIRECT"
  if (/^rejected\.?$/i.test(s)) return "REJECTED"
  if (/^yeah\.?[ \t]+here\.?!?$/i.test(s)) return "Yeah. Here."
  return null
}

/**
 * Maps the assistant’s final reply to a terminal token. Accepts common drift:
 * markdown fences, outer emphasis, multiple Claude `text` blocks joined with
 * newlines, or a decision on its own line (last matching line wins over earlier
 * noise). Used when the model does not return the `groucho_respond` tool.
 */
export function canonicalTerminalDecision(
  raw: string,
): "Yeah. Here." | "REDIRECT" | "REJECTED" | null {
  const full = stripOuterNoise(raw)
  if (!full) return null
  const whole = matchDecisionLine(full)
  if (whole) return whole
  const lines = full.split(/\n/).map((l) => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const d = matchDecisionLine(lines[i]!)
    if (d) return d
  }
  return null
}
