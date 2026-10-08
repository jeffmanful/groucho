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
import {
  APPLICATION_ACTIVITY_STATUSES,
  APPLICATION_MEDIA_CLAIM_KINDS,
  APPLICATION_PROCESS_FEEDBACK_KINDS,
  normaliseProcessFeedbackKind,
  type ApplicationProcessFeedbackKind,
} from "@/lib/application-facts"

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
              "direct when it answers the question; partial when it answers only part; subject_shift when it clearly introduces a different subject; ambiguous when its intended connection cannot yet be known; clarification_request only when the applicant asks you to explain or rephrase your preceding turn. A request to leave an already-covered subject is processFeedback requests_topic_change, not clarification_request.",
          },
          reason: {
            type: "string",
            description:
              "One concise private reason comparing the answer with the preceding question. Do not invent the missing connection.",
          },
        },
        required: ["kind", "reason"],
      },
      processFeedback: {
        type: "string",
        enum: APPLICATION_PROCESS_FEEDBACK_KINDS,
        description: "Use corrects_assistant_assumption when the applicant corrects your factual premise, requests_topic_change when they ask to leave the current subject or say a question repeats what they already supplied, otherwise none. A topic-change request takes precedence over a request for a narrower explanation of the same question. These are process turns, not applicant-fit evidence.",
      },
      activityClaims: {
        type: "array",
        maxItems: 3,
        description: "Source-linked temporal facts from the current applicant answer only. Record a one-off completed event, an actual ongoing habit, or a proposed future activity only when the applicant explicitly distinguishes its status. Copy the exact words carrying that status; return [] when none. A return visit after one event does not make the event an ongoing programme.",
        items: {
          type: "object",
          properties: {
            status: { type: "string", enum: APPLICATION_ACTIVITY_STATUSES },
            quote: { type: "string" },
          },
          required: ["status", "quote"],
        },
      },
      mediaClaim: {
        type: "object",
        description: "Record a claim about the current media exercise only with an exact quote from the current applicant answer. Otherwise return none and an empty quote.",
        properties: {
          kind: { type: "string", enum: APPLICATION_MEDIA_CLAIM_KINDS },
          quote: { type: "string" },
        },
        required: ["kind", "quote"],
      },
      integrityObservation: {
        type: "object",
        description:
          "Use artist_consent_unestablished when the applicant proposes sharing private or unreleased work someone sent them but has not said whether the artist permitted it. This is a question to clarify, not a violation. Use artist_consent_confirmed only when the applicant explicitly says the artist permitted sharing, and cite those words. Use artist_consent_violation when they explicitly say they share, have shared, or would share artist work without permission or despite the artist's hesitation; distinguish intent from completed action. Other concern kinds require equally explicit first-person evidence. Copy an exact quote from this answer; otherwise return none and an empty quote.",
        properties: {
          kind: {
            type: "string",
            enum: ["none", "admitted_fabrication", "artist_consent_unestablished", "artist_consent_confirmed", "artist_consent_violation", "extractive_access_intent"],
          },
          quote: { type: "string" },
        },
        required: ["kind", "quote"],
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
          "Every evidence-lens key newly supported by the current answer, including unfavorable or concerning direct evidence. Coverage records what was observed, not approval or exhaustive exploration. Exclude already-observed lenses and facts supported only by earlier messages. Return an empty array when none is newly supported.",
      },
      relevantSignalKeys: {
        type: "array",
        items: { type: "string" },
        description:
          "Conditional evidence-goal keys made relevant by explicit meaning in the conversation. Return shared goals only when useful; never infer relevance from an orientation label. One concrete disclosure may make several goals relevant.",
      },
      nextSignalKey: {
        type: "string",
        description:
          "Stable key of the evidence lens explored by the visible reply, when one fits. Choose from the live thread, not the first open lens. Use an empty string on terminal turns or when the reply is a contextual conversation turn that does not map to one lens.",
      },
      offerMediaExercise: {
        type: "boolean",
        description:
          "Legacy compatibility switch for the fixed four-performance exercise. Prefer interactionProposal for new rich questions. Set false when interactionProposal is not none.",
      },
      interactionProposal: {
        type: "object",
        description: "Optional rich question using approved IDs from compact state's mediaCatalog. Omit for ordinary conversation. For reference use format image or link with 1-2 IDs and an open question. For choice use format video with 2-4 IDs, mode select/remove/rank, a visible question, and a rationale prompt. Purpose is a short private explanation of what this adds to the conversation. Never invent URLs, assets, or facts about a show.",
        properties: {
          kind: { type: "string", enum: ["none", "reference", "choice"] },
          format: { type: "string", enum: ["image", "link", "video"] },
          assetIds: { type: "array", maxItems: 4, items: { type: "string" } },
          mode: { type: "string", enum: ["select", "remove", "rank"] },
          question: { type: "string" },
          rationalePrompt: { type: "string" },
          purpose: { type: "string" },
        },
        required: ["kind", "format", "assetIds", "mode", "question", "rationalePrompt", "purpose"],
      },
    },
    required: [
      "reply",
      "terminal",
      "scores",
      "answerAssessment",
      "answerRelation",
      "processFeedback",
      "activityClaims",
      "mediaClaim",
      "integrityObservation",
      "conversationMove",
      "coveredSignalKeys",
      "relevantSignalKeys",
      "nextSignalKey",
      "offerMediaExercise",
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
- \`reply\` is the plain-text applicant-visible turn and fallback if a rich interaction cannot be shown. If interactionProposal is valid, its \`question\` becomes the visible turn instead. Keep both on the same conversational intent, in one or two short sentences with at most one question.
- Write the conversation directly. Never use process lead-ins such as \`before we go further\`, \`before we wrap\`, \`let me shift\`, \`let me pivot\`, or \`one last question\`.
- Treat a clear relevant fact, intention, creative medium, COLORS reason, preference, or cultural judgment as usable evidence even when it deserves a follow-up. Reserve thin for genuinely empty, evasive, or non-responsive answers.
- Assess \`answerRelation\` separately from quality. A culturally meaningful answer can be usable or rich while still being a subject shift or ambiguous response to the question just asked.
- When \`answerRelation.kind\` is \`subject_shift\` or \`ambiguous\`, do not pretend the answer resolved the preceding question and do not invent a bridge. Receive the new detail neutrally, ask one short question that lets the applicant explain why they introduced it, and leave \`nextSignalKey\` empty for that repair turn.
- When the applicant asks whether your last turn was a question, or asks what you meant, set \`answerRelation.kind\` to \`clarification_request\`. Own the ambiguity briefly and ask the intended question clearly, staying with the preceding subject. Do not assess their application, diagnose their mood, change topic, claim new evidence, or make a terminal decision. Return empty \`coveredSignalKeys\` and \`nextSignalKey\`.
- Record factual corrections and requests to leave a subject in \`processFeedback\`, even when \`answerRelation.kind\` is direct. Do not count those process turns as applicant-fit evidence. For \`mediaClaim\`, copy an exact quote from the current answer or return none and an empty quote.
- In \`activityClaims\`, preserve the applicant's time frame: one hosted night is one_off, a described actual habit is ongoing, and a circle they want to start is proposed. Use exact current-answer quotes and do not turn a one-off event into the first meeting of a recurring format. If the applicant corrects that premise, own the error in the visible reply.
- For \`integrityObservation\`, cite an exact quote from this answer. A proposal to share unreleased work with no stated permission is artist_consent_unestablished, not a proven violation: ask whether the artist agreed. If the applicant explicitly confirms the artist agreed, return artist_consent_confirmed with that quote. Use artist_consent_violation for an explicit first-person account of sharing or intending to share without permission or despite hesitation; do not describe future intent as completed conduct. Do not infer conduct from a scenario or refusal to share. If a consent concern is unresolved, stay with that boundary rather than opening a new evidence lens.
- On every active turn after a substantive answer, make the next invitation visibly grow from one concrete detail in that answer. Do not emit a bare next-signal or option question after the applicant has supplied a cultural judgment, creative disclosure, or personal observation.
- \`terminal\` is \`none\` until the exchange should end. Terminal replies must use the configured neutral close and never reveal the private outcome.
- \`scores\` and \`answerAssessment\` judge substance rather than length, fluency, status, fame, or familiarity with a reference.
- \`coveredSignalKeys\` includes every open evidence intent newly supported by the current answer. Exclude already-covered goals and evidence supplied only by earlier messages.
- \`relevantSignalKeys\` identifies conditional evidence intents made relevant by the conversation's meaning. Do not rely on magic words, role labels, or orientation scores.
- Participant orientation, response mode, thread bookkeeping, reviewer reporting, and UI presentation state are derived outside this model response. Bridge audit data and cultural-signal extraction are not returned on the live path.
- Consider interactionProposal as another conversational tool, not an application stage. If the approved mediaCatalog makes a relevant question more concrete, propose an image or link reference with a text response, or a video choice with a model-written question and rationale prompt. Select only catalog IDs; the runtime supplies URLs and validates the proposal. Omit interactionProposal when media would distract, and never request it during an unresolved consent, safety, or clarification concern. If the applicant corrects you for asking about unseen media, own that error and use an approved reference when one fits. Set legacy offerMediaExercise false whenever you propose a rich interaction.
- When the applicant explicitly asks to see a performance, image, or link and the approved catalog is available, use interactionProposal to answer that request. If they ask to see one example, choose a single reference card, not a comparison or choice; reserve video choices for a thread about comparing or selecting. Never ask them to inspect material that the UI has not shown.

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
  processFeedback: ApplicationProcessFeedbackKind
  mediaClaim: unknown
  activityClaims: unknown
  integrityObservation: unknown
  conversationMove: ApplicationConversationMove | null
  responseMode: ApplicationResponseMode | null
  participantOrientation: ApplicationParticipantOrientationState
  culturalSignals: CulturalSignal[]
  coveredSignalKeys: string[]
  relevantSignalKeys: string[]
  bridgePlan: ApplicationBridgePlan
  threadState: ApplicationConversationThread
  nextSignalKey: string | null
  offerMediaExercise: boolean
  interactionProposal: unknown
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
    processFeedback: toolSeen
      ? normaliseProcessFeedbackKind(toolInput.processFeedback)
      : "none",
    mediaClaim: toolSeen ? toolInput.mediaClaim : null,
    activityClaims: toolSeen ? toolInput.activityClaims : null,
    integrityObservation: toolSeen ? toolInput.integrityObservation : null,
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
    relevantSignalKeys: toolSeen
      ? normaliseCoveredSignalKeys(toolInput.relevantSignalKeys)
      : [],
    bridgePlan,
    threadState: normaliseApplicationConversationThread(
      toolSeen ? toolInput.threadState : null,
    ),
    nextSignalKey: toolSeen
      ? normaliseNextSignalKey(toolInput.nextSignalKey)
      : null,
    offerMediaExercise: toolSeen && toolInput.offerMediaExercise === true,
    interactionProposal: toolSeen ? toolInput.interactionProposal : null,
    reviewerReport:
      toolSeen && terminal !== "none"
        ? normaliseReviewerReport(toolInput.reviewerReport)
        : null,
  }
}
