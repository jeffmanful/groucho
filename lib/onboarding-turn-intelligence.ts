import Anthropic from "@anthropic-ai/sdk"
import {
  DEFAULT_LOW_COST_ANTHROPIC_MODEL,
  logLlmUsage,
  modelFromEnv,
} from "@/lib/llm-usage"
import {
  ONBOARDING_RESPONSE_TOOL_NAME,
  ONBOARDING_STRUCTURED_SYSTEM_SUFFIX,
  onboardingResponseTool,
  parseOnboardingStructuredResponse,
  type OnboardingTurnAction,
} from "@/lib/onboarding-structured-tool"
import type { OnboardingFlowStep } from "@/lib/project-settings"
import { stepMinAnswerChars } from "@/lib/project-settings"
import {
  applyNaturalLanguageStyle,
  NATURAL_LANGUAGE_REPLY_GUIDANCE,
} from "@/lib/natural-language-style"

const ONBOARDING_TURN_MODEL_ENV = "GROUCHO_ONBOARDING_TURN_MODEL"
const MAX_TOKENS = 400

let client: Anthropic | null = null
function getClient(): Anthropic {
  if (!client) client = new Anthropic()
  return client
}

export type OnboardingTurnContext = {
  personaPrompt: string
  stepAnswered: OnboardingFlowStep
  userAnswer: string
  nextStep: OnboardingFlowStep | null
  boundaryEnabled: boolean
  followupEnabled: boolean
  alreadyInFollowup: boolean
  requestId?: string
  organisationId?: string
  projectId?: string
  sessionId?: string
}

function buildUserPayload(ctx: OnboardingTurnContext): string {
  const lines = [
    `Step answered: "${ctx.stepAnswered.title}"`,
    `Question asked: ${ctx.stepAnswered.question}`,
    `User answer: ${ctx.userAnswer}`,
    `Answer length (chars): ${ctx.userAnswer.trim().length}`,
    `Min chars before follow-up heuristic: ${stepMinAnswerChars(ctx.stepAnswered)}`,
    `Already used follow-up on this step: ${ctx.alreadyInFollowup ? "yes" : "no"}`,
  ]
  if (ctx.nextStep) {
    lines.push(
      "",
      "If action is continue, your reply MUST end with this exact next question:",
      ctx.nextStep.question,
    )
    if (ctx.nextStep.intro?.trim()) {
      lines.push(`(Optional context — next step intro: ${ctx.nextStep.intro.trim()})`)
    }
  } else {
    lines.push("", "This was the final step — action should be continue with a brief thanks only.")
  }
  return lines.join("\n")
}

export type OnboardingTurnResult = {
  reply: string
  action: OnboardingTurnAction
  usedLlm: boolean
}

/** Heuristic follow-up before calling LLM. */
export function shouldHeuristicFollowup(
  step: OnboardingFlowStep,
  answer: string,
  alreadyInFollowup: boolean,
  followupEnabled: boolean,
): boolean {
  if (!followupEnabled || alreadyInFollowup) return false
  return answer.trim().length < stepMinAnswerChars(step)
}

export function defaultFollowupPrompt(step: OnboardingFlowStep): string {
  return (
    step.followup_prompt?.trim() ||
    "Can you make that a little more concrete? What would that look like in practice?"
  )
}

export function verbatimNextMessage(
  nextStep: OnboardingFlowStep,
  welcomePrefix?: string,
): string {
  const parts: string[] = []
  if (welcomePrefix?.trim()) parts.push(welcomePrefix.trim())
  if (nextStep.intro?.trim()) parts.push(nextStep.intro.trim())
  parts.push(nextStep.question)
  return parts.join("\n\n")
}

function ensureEndsWithQuestion(reply: string, exactQuestion: string): string {
  const q = exactQuestion.trim()
  if (!q) return reply
  if (reply.includes(q)) return reply
  const base = reply.trim()
  return base ? `${base}\n\n${q}` : q
}

export async function runOnboardingTurnIntelligence(
  ctx: OnboardingTurnContext,
): Promise<OnboardingTurnResult | null> {
  const system =
    ctx.personaPrompt.trim() +
    ONBOARDING_STRUCTURED_SYSTEM_SUFFIX +
    (ctx.boundaryEnabled
      ? "\n\nUse action `boundary` only for serious dignity, safety, or exclusion issues — respond calmly, do not advance."
      : "\n\nDo not use action `boundary` for this project.") +
    (ctx.followupEnabled && !ctx.alreadyInFollowup
      ? "\n\nUse action `followup` at most once per step when the answer is too brief or vague."
      : "\n\nDo not use action `followup`. Either continue or use boundary.") +
    `\n\n${NATURAL_LANGUAGE_REPLY_GUIDANCE}`

  try {
    const model = modelFromEnv(
      ONBOARDING_TURN_MODEL_ENV,
      DEFAULT_LOW_COST_ANTHROPIC_MODEL,
    )
    const response = await getClient().messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system,
      tools: [onboardingResponseTool],
      tool_choice: { type: "tool", name: ONBOARDING_RESPONSE_TOOL_NAME },
      messages: [{ role: "user", content: buildUserPayload(ctx) }],
    })
    logLlmUsage({
      operation: "onboarding_turn_intelligence",
      provider: "anthropic",
      model,
      usage: response.usage,
      requestId: ctx.requestId,
      organisationId: ctx.organisationId,
      projectId: ctx.projectId,
      sessionId: ctx.sessionId,
    })

    const parsed = parseOnboardingStructuredResponse(response.content)
    if (!parsed.toolSeen || !parsed.action) return null

    let reply = parsed.reply
    if (parsed.action === "continue" && ctx.nextStep) {
      reply = ensureEndsWithQuestion(reply, ctx.nextStep.question)
    }

    return {
      reply: applyNaturalLanguageStyle(reply),
      action: parsed.action,
      usedLlm: true,
    }
  } catch {
    return null
  }
}

export function fallbackBridgeReply(
  nextStep: OnboardingFlowStep,
  welcomePrefix?: string,
): string {
  return verbatimNextMessage(nextStep, welcomePrefix)
}
