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
  CULTURAL_SIGNAL_TYPES,
  normaliseCulturalSignals,
  type CulturalSignal,
} from "@/lib/cultural-signal-contract"
import {
  APPLICANT_CONVERSATION_ENERGY,
  CONVERSATION_THREAD_MOMENTUM,
  normaliseApplicationConversationThread,
  type ApplicationConversationThread,
} from "@/lib/application-conversation-thread"
import {
  APPLICATION_RESPONSE_MODES,
  normaliseApplicationResponseMode,
  type ApplicationResponseMode,
} from "@/lib/application-response-mode"
import {
  APPLICATION_BRIDGE_KINDS,
  normaliseApplicationBridgePlan,
  type ApplicationBridgePlan,
} from "@/lib/application-conversation-bridge"

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
          evidence: {
            type: "object",
            properties: {
              personalPointOfView: { type: "boolean" },
              concreteDetail: { type: "boolean" },
              emotionalConnection: { type: "boolean" },
              independentJudgment: { type: "boolean" },
              careOrContext: { type: "boolean" },
            },
            required: [
              "personalPointOfView",
              "concreteDetail",
              "emotionalConnection",
              "independentJudgment",
              "careOrContext",
            ],
          },
        },
        required: ["quality", "reason", "evidence"],
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
      responseMode: {
        type: "string",
        enum: APPLICATION_RESPONSE_MODES,
        description:
          "How Groucho shapes this reply. This is separate from the routing move and should vary with the live thread and recent response-mode history.",
      },
      culturalSignals: {
        type: "array",
        maxItems: 8,
        description:
          "Private structured cultural signals explicitly present in the current answer. Never include quotes, stories, identity, contact details, or inferred sensitive traits.",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: CULTURAL_SIGNAL_TYPES,
            },
            displayLabel: {
              type: "string",
              description:
                "A short normalized cultural reference or broad theme label, never a quotation or sentence from the answer.",
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
          },
          required: ["type", "displayLabel", "confidence"],
        },
      },
      coveredSignalKeys: {
        type: "array",
        items: { type: "string" },
        description:
          "Every application evidence-goal key explicitly supported by the current answer. One answer may cover several goals. Return an empty array when none is supported.",
      },
      bridgeCandidates: {
        type: "array",
        maxItems: 3,
        description:
          "Up to three private ways the next reply could grow from an explicit applicant detail into an open evidence goal. These are plans, never applicant-facing copy.",
        items: {
          type: "object",
          properties: {
            sourceDetail: {
              type: "string",
              description:
                "Concise paraphrase of the explicit applicant detail that creates this bridge.",
            },
            kind: { type: "string", enum: APPLICATION_BRIDGE_KINDS },
            targetSignalKey: {
              type: "string",
              description:
                "Open evidence-goal key this bridge advances, or an empty string if no valid goal exists.",
            },
            questionIntent: {
              type: "string",
              description:
                "What the next question should understand, without scripting its exact wording.",
            },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            freshness: {
              type: "string",
              enum: ["current", "recent", "earlier"],
            },
          },
          required: [
            "sourceDetail",
            "kind",
            "targetSignalKey",
            "questionIntent",
            "confidence",
            "freshness",
          ],
        },
      },
      selectedBridgeIndex: {
        type: "integer",
        minimum: -1,
        maximum: 2,
        description:
          "Index of the bridgeCandidates entry used to shape reply, or -1 when a pivot or close is more natural.",
      },
      threadState: {
        type: "object",
        description:
          "Private concise state of the live conversational thread, updated from the current answer and reply. Never expose this object to the applicant.",
        properties: {
          subject: {
            type: "string",
            description: "Current subject being explored, or an empty string.",
          },
          strongestDetail: {
            type: "string",
            description:
              "Most particular applicant detail worth retaining, paraphrased concisely, or an empty string.",
          },
          openHook: {
            type: "string",
            description:
              "Unresolved observation, tension, or avenue with conversational value, or an empty string.",
          },
          momentum: {
            type: "string",
            enum: CONVERSATION_THREAD_MOMENTUM,
          },
          applicantEnergy: {
            type: "string",
            enum: APPLICANT_CONVERSATION_ENERGY,
            description:
              "Observable conversational posture only. Do not infer identity, health, or psychological traits.",
          },
          acknowledgedDetails: {
            type: "array",
            maxItems: 4,
            items: { type: "string" },
            description:
              "Concise details Groucho has already explicitly responded to, so they are not acknowledged generically again.",
          },
        },
        required: [
          "subject",
          "strongestDetail",
          "openHook",
          "momentum",
          "applicantEnergy",
          "acknowledgedDetails",
        ],
      },
      nextSignalKey: {
        type: "string",
        description:
          "Stable key of the open evidence goal requested by reply. Choose the goal with the most natural connection to the current answer, not simply the first listed goal. Use an empty string on terminal turns or when no compact state was provided.",
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
      "answerAssessment",
      "conversationMove",
      "responseMode",
      "culturalSignals",
      "coveredSignalKeys",
      "bridgeCandidates",
      "selectedBridgeIndex",
      "threadState",
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
- \`answerAssessment\`: private assessment of the current answer. Use \`thin\` only when the answer lacks usable evidence for the current signal, not merely because it is short. Use \`usable\` when there is enough evidence to advance, \`rich\` for a particular observation, tension, personal connection, independent judgment, or meaningful context, and \`concerning\` for possible safety, dignity, integrity, or extractive concerns.
- \`conversationMove\`: propose \`clarify\`, \`open_door\`, \`advance\`, \`rabbit_hole\`, \`challenge\`, or \`decide\`. Follow the compact state's conversationDepth and turn budgets. The runtime validates this proposal.
- \`responseMode\`: choose how the reply participates: \`reflect\` names a specific detail; \`interpret\` offers a tentative reading; \`probe\` asks for concrete evidence; \`deepen\` explores the live hook; \`connect\` joins the answer to something said earlier; \`challenge\` calmly questions a concern; \`pivot\` changes subject cleanly without announcing the transition; \`close\` ends the application. Do not repeat the same shape mechanically. Active replies should leave a clear invitation to respond, but need not be formatted as acknowledgement plus next question.
- \`culturalSignals\`: extract only explicit, project-level cultural references from the current answer. Use the allowed taxonomy, a short normalized display label, and confidence. Never copy a quote or sentence; never include identity, contact details, personal stories, health, sexuality, ethnicity, religion, politics, or other inferred sensitive traits. Return an empty array when nothing qualifies. \`emerging_theme\` must be a broad cultural theme suitable for human approval, not a paraphrase of one applicant.
- \`coveredSignalKeys\`: return every application evidence goal supported by the current answer, not only the goal behind the current question. One answer can cover several goals. Use only keys supplied in the compact state; return an empty array if no compact state or no goal is supported.
- \`bridgeCandidates\`: privately generate zero to three ways to grow from an explicit applicant detail into an open evidence goal. Use a reusable bridge kind, preserve the source detail, state the question intent rather than canned wording, and assign honest confidence. Prefer current details over callbacks. Never invent a detail.
- \`selectedBridgeIndex\`: index of the candidate actually used to shape \`reply\`, or \`-1\` when no bridge is worthwhile. Choose for continuity, evidence value, specificity, momentum, and novelty. Avoid repeating recent bridge kinds supplied in compact state. A bridge replaces a generic question; it never adds a bonus turn.
- \`threadState\`: update the private live-thread state. Keep a concise current subject, strongest particular detail, unresolved hook, momentum, observable applicant energy, and up to four details already acknowledged. Continue a productive thread instead of pivoting merely because another goal is open. Use concise paraphrases; never add contact details, diagnoses, protected traits, hidden scores, or unsupported claims.
- \`nextSignalKey\`: key of the application signal requested by \`reply\`. Choose a key from the compact application state. Use an empty string on terminal turns or when no compact signal state was provided.
- \`reviewerReport\`: required when \`terminal\` is not \`none\`. This is private reviewer evidence, not applicant copy. Include \`applicant_bio\`, \`advisory_recommendation\` (\`recommend\`, \`human_review\`, or \`decline\`), \`confidence_score\`, \`evidence_summary\`, \`weak_or_missing_signals\`, \`safety_or_integrity_flags\`, and \`reviewer_focus\`.

When the applicant names an artist or creative reference, prefer a personal follow-up about why it matters to them. Do not verify or gatekeep based on whether the artist is recognized.

When the same answer also reveals that the applicant makes music, prefer a fresh \`maker_to_practice\` bridge into an open core goal over a supporting artist-recommendation bridge. Render bridges invisibly: never say “that matters”, “that connection matters”, “let me shift”, “let me pivot”, or “moving on”. Ask one direct question and do not combine two evidence asks in it.

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
  answerAssessment: ApplicationAnswerAssessment | null
  conversationMove: ApplicationConversationMove | null
  responseMode: ApplicationResponseMode | null
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
      if (typeof r === "string") reply = r.trim()
    }
  }

  if (!reply) reply = textParts.join("\n").trim()
  if (toolSeen && terminal === null) terminal = "none"

  const resolvedTerminal = terminal ?? "none"
  const interaction = toolSeen
    ? normaliseInteractionSpec(toolInput, resolvedTerminal)
    : { ...DEFAULT_INTERACTION_SPEC }
  const bridgePlan = normaliseApplicationBridgePlan({
    candidates: toolSeen ? toolInput.bridgeCandidates : [],
    selectedIndex: toolSeen ? toolInput.selectedBridgeIndex : -1,
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
    conversationMove: toolSeen
      ? normaliseApplicationConversationMove(toolInput.conversationMove)
      : null,
    responseMode: toolSeen
      ? normaliseApplicationResponseMode(toolInput.responseMode)
      : null,
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
