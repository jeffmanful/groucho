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
import {
  normaliseApplicationAnswerAssessment,
  normaliseApplicationConversationMove,
  type ApplicationAnswerAssessment,
  type ApplicationConversationMove,
} from "@/lib/application-conversation-depth"
import {
  normaliseCulturalSignals,
  type CulturalSignal,
} from "@/lib/cultural-signal-contract"
import {
  normaliseApplicationConversationThread,
  type ApplicationConversationThread,
} from "@/lib/application-conversation-thread"
import {
  normaliseApplicationResponseMode,
  type ApplicationResponseMode,
} from "@/lib/application-response-mode"
import {
  normaliseApplicationBridgePlan,
  type ApplicationBridgePlan,
} from "@/lib/application-conversation-bridge"
import {
  normaliseApplicationParticipantOrientation,
  type ApplicationParticipantOrientationState,
} from "@/lib/application-participant-orientation"
import {
  APPLICATION_ANSWER_RELATIONS,
  normaliseApplicationAnswerRelation,
  type ApplicationAnswerRelation,
} from "@/lib/application-answer-relation"

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
    "Required every turn. Returns the applicant-facing reply plus only the private fields needed to validate and route the current turn.",
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
      answerAssessment: {
        type: "object",
        description:
          "Private assessment of the current answer. Judge usable evidence, not length, polish, fluency, status, fame, or whether a reference is recognised.",
        properties: {
          quality: {
            type: "string",
            enum: ["thin", "usable", "rich", "concerning"],
          },
          reason: {
            type: "string",
            description:
              "One short private reason grounded in the answer. Never expose it to the applicant.",
          },
          evidenceFlags: {
            type: "array",
            maxItems: 5,
            uniqueItems: true,
            items: {
              type: "string",
              enum: ["point_of_view", "detail", "emotion", "judgment", "care"],
            },
            description:
              "Compact evidence traits present in the current answer. Return an empty array when none apply.",
          },
        },
        required: ["quality", "reason", "evidenceFlags"],
      },
      answerRelation: {
        type: "object",
        description:
          "Private assessment of how the current answer relates to the immediately preceding visible question. This is separate from answer quality.",
        properties: {
          kind: {
            type: "string",
            enum: APPLICATION_ANSWER_RELATIONS,
            description:
              "direct when it answers the question; partial when it answers only part; subject_shift when it clearly introduces a different subject; ambiguous when its intended connection cannot yet be known.",
          },
          reason: {
            type: "string",
            description:
              "One concise private reason comparing the answer with the preceding question. Do not invent the missing connection.",
          },
        },
        required: ["kind", "reason"],
      },
      conversationMove: {
        type: "string",
        enum: [
          "clarify",
          "open_door",
          "advance",
          "rabbit_hole",
          "challenge",
          "decide",
        ],
        description:
          "Proposed route for this turn. The runtime validates it against the quality trajectory and remaining budgets.",
      },
      coveredSignalKeys: {
        type: "array",
        items: { type: "string" },
        description:
          "Every application evidence-goal key explicitly supported by the current answer. One answer may cover several goals. Return an empty array when none is supported.",
      },
      nextSignalKey: {
        type: "string",
        description:
          "Stable key of the open evidence goal requested by reply. Choose the goal with the most natural connection to the current answer, not simply the first listed goal. Use an empty string on terminal turns or when no compact state was provided.",
      },
    },
    required: [
      "reply",
      "terminal",
      "scores",
      "answerAssessment",
      "answerRelation",
      "conversationMove",
      "coveredSignalKeys",
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
- Return the smallest valid object. Keep private strings concise.
- \`reply\` is the only applicant-visible field. Use one or two short sentences and at most one question.
- Write the conversation directly. Never use process lead-ins such as \`before we go further\`, \`before we wrap\`, \`let me shift\`, \`let me pivot\`, or \`one last question\`.
- Treat a clear relevant fact, intention, creative medium, COLORS reason, preference, or cultural judgment as usable evidence even when it deserves a follow-up. Reserve thin for genuinely empty, evasive, or non-responsive answers.
- Assess \`answerRelation\` separately from quality. A culturally meaningful answer can be usable or rich while still being a subject shift or ambiguous response to the question just asked.
- When \`answerRelation.kind\` is \`subject_shift\` or \`ambiguous\`, do not pretend the answer resolved the preceding question and do not invent a bridge. Receive the new detail neutrally, ask one short question that lets the applicant explain why they introduced it, and leave \`nextSignalKey\` empty for that repair turn.
- On every active turn after a substantive answer, make the next invitation visibly grow from one concrete detail in that answer. Do not emit a bare next-signal or option question after the applicant has supplied a cultural judgment, creative disclosure, or personal observation.
- \`terminal\` is \`none\` until the exchange should end. Terminal replies must use the configured neutral close and never reveal the private outcome.
- \`scores\` and \`answerAssessment\` judge substance rather than length, fluency, status, fame, or familiarity with a reference.
- \`coveredSignalKeys\` includes every supplied evidence intent supported by the current answer.
- Participant orientation, response mode, thread bookkeeping, reviewer reporting, and UI presentation state are derived outside this model response. Bridge audit data and cultural-signal extraction are not returned on the live path.

Do not emit a plain assistant text reply only; the tool call is required.`

export type ParsedGatekeeperStructured = {
  reply: string
  /** Resolved terminal when the model used the tool; otherwise \`null\`. */
  terminal: GatekeeperTerminalField | null
  toolSeen: boolean
  interaction: GrouchoInteractionSpec
  scores: Score
  answerAssessment: ApplicationAnswerAssessment | null
  answerRelation: ApplicationAnswerRelation | null
  conversationMove: ApplicationConversationMove | null
  responseMode: ApplicationResponseMode | null
  participantOrientation: ApplicationParticipantOrientationState
  culturalSignals: CulturalSignal[]
  coveredSignalKeys: string[]
  bridgePlan: ApplicationBridgePlan
  threadState: ApplicationConversationThread
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

function normaliseCoveredSignalKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((key): key is string =>
    typeof key === "string" && /^[a-z0-9_]{1,64}$/.test(key),
  ))].slice(0, 12)
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
      if (typeof r === "string") reply = r.trim().replace(/\\n/g, "\n")
    }
  }

  if (!reply) reply = textParts.join("\n").trim()
  if (toolSeen && terminal === null) terminal = "none"

  const resolvedTerminal = terminal ?? "none"
  const interaction = toolSeen
    ? normaliseInteractionSpec(toolInput, resolvedTerminal)
    : { ...DEFAULT_INTERACTION_SPEC }
  const selectedBridge = toolSeen ? toolInput.selectedBridge : null
  const bridgePlan = normaliseApplicationBridgePlan({
    candidates: selectedBridge
      ? [selectedBridge]
      : toolSeen
        ? toolInput.bridgeCandidates
        : [],
    selectedIndex: selectedBridge
      ? 0
      : toolSeen
        ? toolInput.selectedBridgeIndex
        : -1,
  })

  return {
    reply,
    terminal: toolSeen ? terminal : null,
    toolSeen,
    interaction,
    scores: toolSeen ? normaliseScores(toolInput.scores) : { ...NEUTRAL_SCORES },
    answerAssessment: toolSeen
      ? normaliseApplicationAnswerAssessment(toolInput.answerAssessment)
      : null,
    answerRelation: toolSeen
      ? normaliseApplicationAnswerRelation(toolInput.answerRelation)
      : null,
    conversationMove: toolSeen
      ? normaliseApplicationConversationMove(toolInput.conversationMove)
      : null,
    responseMode: toolSeen
      ? normaliseApplicationResponseMode(toolInput.responseMode)
      : null,
    participantOrientation: normaliseApplicationParticipantOrientation(
      toolSeen ? toolInput.participantOrientation : null,
    ),
    culturalSignals: toolSeen
      ? normaliseCulturalSignals(toolInput.culturalSignals)
      : [],
    coveredSignalKeys: toolSeen
      ? normaliseCoveredSignalKeys(toolInput.coveredSignalKeys)
      : [],
    bridgePlan,
    threadState: normaliseApplicationConversationThread(
      toolSeen ? toolInput.threadState : null,
    ),
    nextSignalKey: toolSeen
      ? normaliseNextSignalKey(toolInput.nextSignalKey)
      : null,
    reviewerReport:
      toolSeen && terminal !== "none"
        ? normaliseReviewerReport(toolInput.reviewerReport)
        : null,
  }
}
