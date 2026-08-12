import type Anthropic from "@anthropic-ai/sdk"
import {
  DEFAULT_INTERACTION_SPEC,
  normaliseInteractionSpec,
  type GatekeeperTerminalField,
  type GrouchoInteractionSpec,
} from "@/lib/gatekeeper-interaction-spec"
import type { Score } from "@/lib/scoring"
import {
  normaliseReviewerReport,
  type ReviewerReport,
} from "@/lib/reviewer-report"

export type {
  GatekeeperTerminalField,
  GrouchoInteractionSpec,
  GrouchoInteractionUi,
  GrouchoIntent,
  GrouchoInputType,
  GrouchoEmotionalState,
  GrouchoVisualState,
} from "@/lib/gatekeeper-interaction-spec"

/** Tool name must stay stable — referenced in system suffix and parsers. */
export const GATEKEEPER_RESPONSE_TOOL_NAME = "groucho_respond" as const

export const gatekeeperResponseTool = {
  name: GATEKEEPER_RESPONSE_TOOL_NAME,
  description:
    "Required every turn. Returns the applicant-facing reply plus the interaction spec for the client UI.",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description:
          "User-visible assistant message (keep within the persona's length and tone rules).",
      },
      terminal: {
        type: "string",
        enum: ["none", "pass", "redirect", "reject"],
        description:
          "`none` while the conversation continues. `pass`, `redirect`, or `reject` when this turn concludes the session.",
      },
      intent: {
        type: "string",
        enum: [
          "probe",
          "clarify",
          "challenge",
          "acknowledge",
          "decide",
          "redirect",
          "reject",
        ],
        description: "What this turn is trying to do conversationally.",
      },
      inputType: {
        type: "string",
        enum: ["text", "singleSelect", "multiSelect", "ranking", "voice"],
        description: "How the applicant should respond on the next turn.",
      },
      options: {
        type: "array",
        items: { type: "string" },
        description:
          "Required when inputType is singleSelect, multiSelect, or ranking.",
      },
      emotionalState: {
        type: "string",
        enum: [
          "neutral",
          "curious",
          "interested",
          "skeptical",
          "evaluating",
          "decisive",
        ],
        description: "Groucho's conversational posture this turn.",
      },
      visualState: {
        type: "string",
        enum: [
          "idle",
          "listening",
          "thinking",
          "curious",
          "interested",
          "evaluating",
          "decision",
        ],
        description: "How the client should animate Groucho's presence.",
      },
      scores: {
        type: "object",
        description:
          "Accumulated assessment of the applicant across the conversation so far. These scores are private and must not be mentioned in the reply.",
        properties: {
          specificity: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "How concrete and specific the applicant's answers are.",
          },
          authenticity: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description:
              "How personal and genuine the answers appear, without rewarding polish or fluency.",
          },
          cultural_depth: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description:
              "How much care, context, generosity, and community awareness the applicant demonstrates.",
          },
          overall: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "Overall fit based on the accumulated evidence so far.",
          },
        },
        required: ["specificity", "authenticity", "cultural_depth", "overall"],
      },
      nextSignalKey: {
        type: "string",
        description:
          "Stable key of the application signal requested by reply. Use an empty string on terminal turns or when no compact signal state was provided.",
      },
      reviewerReport: {
        type: "object",
        description:
          "Required on terminal turns. Private reviewer-facing applicant report. Never mention this report or its recommendation to the applicant.",
        properties: {
          applicant_bio: {
            type: "string",
            description:
              "Neutral 1-3 sentence bio/report summary based only on the applicant's answers.",
          },
          advisory_recommendation: {
            type: "string",
            enum: ["recommend", "human_review", "decline"],
            description:
              "Advisory label for the human reviewer. It does not make the final community decision.",
          },
          confidence_score: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description:
              "Confidence in the advisory recommendation based on evidence quality, not polish, fluency, fame, or status.",
          },
          evidence_summary: {
            type: "array",
            items: { type: "string" },
            description:
              "Concrete evidence supporting the recommendation. Prefer specific participation, role/actions, results, and Forum contribution.",
          },
          weak_or_missing_signals: {
            type: "array",
            items: { type: "string" },
            description:
              "Important rubric signals that remain vague, unresolved, contradictory, or insufficient.",
          },
          safety_or_integrity_flags: {
            type: "array",
            items: { type: "string" },
            description:
              "Contradictions, refusals, repeated avoidance, abusive/discriminatory language, or other reviewer concerns.",
          },
          reviewer_focus: {
            type: "string",
            description:
              "One short note telling the human reviewer what to pay attention to before making the final decision.",
          },
        },
        required: [
          "applicant_bio",
          "advisory_recommendation",
          "confidence_score",
          "evidence_summary",
          "weak_or_missing_signals",
          "safety_or_integrity_flags",
          "reviewer_focus",
        ],
      },
    },
    required: [
      "reply",
      "terminal",
      "intent",
      "inputType",
      "emotionalState",
      "visualState",
      "scores",
      "nextSignalKey",
    ],
  },
} as const satisfies Anthropic.Tool

/**
 * Appended after persona + outcome appendix so Claude always sees tool contract.
 */
export const GATEKEEPER_STRUCTURED_SYSTEM_SUFFIX = `---

TECHNICAL — Groucho runtime (non-negotiable)

Every assistant turn you MUST call the tool \`${GATEKEEPER_RESPONSE_TOOL_NAME}\` exactly once.
- \`reply\`: string shown to the applicant.
- \`terminal\`: one of \`none\` | \`pass\` | \`redirect\` | \`reject\`. Use \`none\` until you intentionally end the session.
- \`intent\`: conversational goal for this turn (\`probe\`, \`clarify\`, \`challenge\`, \`acknowledge\`, \`decide\`, \`redirect\`, \`reject\`).
- \`inputType\`: how the applicant should answer next (\`text\`, \`singleSelect\`, \`multiSelect\`, \`ranking\`, \`voice\`). Prefer \`text\` unless a structured input clearly fits.
- \`options\`: include when \`inputType\` is \`singleSelect\`, \`multiSelect\`, or \`ranking\`.
- \`emotionalState\`: Groucho's posture (\`neutral\`, \`curious\`, \`interested\`, \`skeptical\`, \`evaluating\`, \`decisive\`).
- \`visualState\`: client animation state (\`idle\`, \`listening\`, \`thinking\`, \`curious\`, \`interested\`, \`evaluating\`, \`decision\`).
- \`scores\`: private accumulated assessment across the full conversation so far. Return numbers from 0 to 1 for \`specificity\`, \`authenticity\`, \`cultural_depth\`, and \`overall\`. Judge substance rather than polish, fluency, status, or whether you recognize an artist. Never mention scores to the applicant.
- \`nextSignalKey\`: key of the application signal requested by \`reply\`. Choose a key from the compact application state. Use an empty string on terminal turns or when no compact signal state was provided.
- If compact state includes \`current.investigationDirective.shouldInvestigate: true\`, your reply must ask a follow-up on that current signal and \`nextSignalKey\` must equal \`current.investigationDirective.recommendedNextSignalKey\`. Do not advance to \`nextRequiredSignalKey\` on that turn.
- \`reviewerReport\`: required when \`terminal\` is not \`none\`. This is private reviewer evidence, not applicant copy. Include \`applicant_bio\`, \`advisory_recommendation\` (\`recommend\`, \`human_review\`, or \`decline\`), \`confidence_score\`, \`evidence_summary\`, \`weak_or_missing_signals\`, \`safety_or_integrity_flags\`, and \`reviewer_focus\`.

When the applicant names an artist or creative reference, prefer a personal follow-up about why it matters to them. Do not verify or gatekeep based on whether the artist is recognized.

On terminal turns, \`terminal\` carries the private judgment. The applicant-facing \`reply\` must be a neutral thank-you/application-received close, not acceptance, rejection, redirect, or access copy.

Groucho is advisory only. Every completed application is reviewed by a human. Never imply that your terminal value, advisory recommendation, confidence score, or reviewer report makes the final community decision.

Do not emit a plain assistant text reply only; the tool call is required.`

export type ParsedGatekeeperStructured = {
  reply: string
  /** Resolved terminal when the model used the tool; otherwise \`null\`. */
  terminal: GatekeeperTerminalField | null
  toolSeen: boolean
  interaction: GrouchoInteractionSpec
  scores: Score
  nextSignalKey: string | null
  reviewerReport: ReviewerReport | null
}

const NEUTRAL_SCORES: Score = {
  specificity: 0.5,
  authenticity: 0.5,
  cultural_depth: 0.5,
  overall: 0.5,
}

function clampScore(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null
  return Math.max(0, Math.min(1, raw))
}

function normaliseScores(raw: unknown): Score {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...NEUTRAL_SCORES }
  }
  const values = raw as Record<string, unknown>
  const specificity = clampScore(values.specificity)
  const authenticity = clampScore(values.authenticity)
  const culturalDepth = clampScore(values.cultural_depth)
  const overall = clampScore(values.overall)
  if (
    specificity === null ||
    authenticity === null ||
    culturalDepth === null ||
    overall === null
  ) {
    return { ...NEUTRAL_SCORES }
  }
  return {
    specificity,
    authenticity,
    cultural_depth: culturalDepth,
    overall,
  }
}

function normaliseTerminal(raw: unknown): GatekeeperTerminalField | null {
  if (raw === "none" || raw === "pass" || raw === "redirect" || raw === "reject")
    return raw
  return null
}

function normaliseNextSignalKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const key = raw.trim()
  return key ? key.slice(0, 64) : null
}

export function parseGatekeeperStructuredResponse(
  content: Anthropic.ContentBlock[],
): ParsedGatekeeperStructured {
  const textParts: string[] = []
  let reply = ""
  let terminal: GatekeeperTerminalField | null = null
  let toolSeen = false
  let toolInput: Record<string, unknown> = {}

  for (const b of content) {
    if (b.type === "text") textParts.push(b.text)
    if (b.type === "tool_use" && b.name === GATEKEEPER_RESPONSE_TOOL_NAME) {
      toolSeen = true
      toolInput = b.input as Record<string, unknown>
      terminal = normaliseTerminal(toolInput.terminal)
      const r = toolInput.reply
      if (typeof r === "string") reply = r.trim()
    }
  }

  if (!reply) reply = textParts.join("\n").trim()
  if (toolSeen && terminal === null) terminal = "none"

  const resolvedTerminal = terminal ?? "none"
  const interaction = toolSeen
    ? normaliseInteractionSpec(toolInput, resolvedTerminal)
    : { ...DEFAULT_INTERACTION_SPEC }

  return {
    reply,
    terminal: toolSeen ? terminal : null,
    toolSeen,
    interaction,
    scores: toolSeen ? normaliseScores(toolInput.scores) : { ...NEUTRAL_SCORES },
    nextSignalKey: toolSeen
      ? normaliseNextSignalKey(toolInput.nextSignalKey)
      : null,
    reviewerReport:
      toolSeen && terminal !== "none"
        ? normaliseReviewerReport(toolInput.reviewerReport)
        : null,
  }
}
