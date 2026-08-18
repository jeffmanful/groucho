import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import {
  applicantIdentityFromRow,
  applicantIdentityPayload,
  type ApplicantIdentity,
} from "@/lib/applicant-identity"
import type { ConversationMessage } from "@/lib/scoring"
import { log } from "@/lib/logger"
import { REQUEST_ID_HEADER } from "@/lib/request-trace"
import { supabase } from "@/lib/supabase"
import { isConcludedSessionStatus } from "@/lib/session-status"
import {
  buildOnboardingProfileSchema,
  formatStepPrompt,
  resolveRuntimeFlowConfig,
  type NormalizedProjectSettings,
  type OnboardingFlowStep,
} from "@/lib/project-settings"
import type { ProjectContext } from "@/lib/project-resolution"
import { touchApiKeyLastUsed } from "@/lib/project-resolution"
import { recordVerdictAndEnqueueWebhooks } from "@/lib/verdict-webhook"
import type { PostSessionMessageInput } from "@/lib/post-session-message"
import {
  DEFAULT_CLOSING,
  generateOnboardingCompletion,
} from "@/lib/onboarding-completion"
import {
  defaultFollowupPrompt,
  fallbackBridgeReply,
  runOnboardingTurnIntelligence,
  shouldHeuristicFollowup,
  verbatimNextMessage,
} from "@/lib/onboarding-turn-intelligence"

const NEUTRAL_SCORES = {
  specificity: 0.5,
  authenticity: 0.5,
  cultural_depth: 0.5,
  overall: 0.5,
}

const BOUNDARY_REPLY =
  "I cannot treat that as a neutral position. We protect dignity and belonging first. If you'd like to continue, you're welcome to answer the question again."

function traceJson(
  input: PostSessionMessageInput,
  body: unknown,
  init?: ResponseInit,
): NextResponse {
  const headers = new Headers(init?.headers)
  if (input.requestId) headers.set(REQUEST_ID_HEADER, input.requestId)
  return NextResponse.json(body, { ...init, headers })
}

function stepIndex(steps: OnboardingFlowStep[], stepId: string): number {
  return steps.findIndex((s) => s.id === stepId)
}

function currentStepPayload(steps: OnboardingFlowStep[], stepId: string) {
  const idx = stepIndex(steps, stepId)
  if (idx < 0) return null
  return {
    id: steps[idx].id,
    title: steps[idx].title,
    index: idx,
    total: steps.length,
    ...(steps[idx].interaction ? { interaction: steps[idx].interaction } : {}),
  }
}

type OnboardingState = {
  followup_step_id?: string
}

function parseOnboardingState(raw: unknown): OnboardingState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const o = raw as Record<string, unknown>
  const id =
    typeof o.followup_step_id === "string" ? o.followup_step_id.trim() : undefined
  return id ? { followup_step_id: id } : {}
}

export type PostOnboardingMessageInput = PostSessionMessageInput & {
  context: ProjectContext
  projectSettings: NormalizedProjectSettings
}

export async function postOnboardingMessage(
  input: PostOnboardingMessageInput,
): Promise<NextResponse> {
  const { message, sessionId, personaId } = input
  const { organisationId, projectId, apiKeyId } = input.context
  const flow = resolveRuntimeFlowConfig(input.projectSettings)
  const experience = input.projectSettings.onboardingExperience

  if (!flow || flow.steps.length === 0) {
    log.error("onboarding_flow_missing", {
      requestId: input.requestId,
      projectId,
    })
    return traceJson(
      input,
      { error: "Onboarding flow is not configured for this project" },
      { status: 500 },
    )
  }

  const steps = flow.steps
  const welcome = flow.welcome_message?.trim() || undefined

  if (apiKeyId) touchApiKeyLastUsed(apiKeyId)

  let resolvedPersonaId: string | null = null
  const settingsPersonaId =
    typeof input.projectSettings.raw.persona_id === "string"
      ? input.projectSettings.raw.persona_id
      : null
  const personaLookupId = personaId?.trim() || settingsPersonaId

  type PersonaRow = {
    id: string
    prompt: string
    profile_schema?: unknown
    profile_extractor_hint?: string | null
  }

  let personaForExtraction: PersonaRow | null = null
  const personaCols = "id, prompt, profile_schema, profile_extractor_hint"

  if (personaLookupId) {
    const { data } = await supabase
      .from("personas")
      .select(personaCols)
      .eq("id", personaLookupId)
      .eq("is_active", true)
      .maybeSingle()
    personaForExtraction = data as PersonaRow | null
    resolvedPersonaId = personaForExtraction?.id ?? null
  }

  if (!personaForExtraction) {
    const { data } = await supabase
      .from("personas")
      .select(personaCols)
      .eq("is_active", true)
      .eq("is_default", true)
      .maybeSingle()
    personaForExtraction = data as PersonaRow | null
    resolvedPersonaId = personaForExtraction?.id ?? null
  }

  const personaPrompt =
    personaForExtraction?.prompt?.trim() ||
    "You are a calm, thoughtful onboarding host. Keep replies brief and human."

  const onboardingSchema = buildOnboardingProfileSchema(steps)
  const mergedPersona = {
    profile_schema:
      personaForExtraction?.profile_schema ?? onboardingSchema,
    profile_extractor_hint:
      personaForExtraction?.profile_extractor_hint ??
      "Map each onboarding step answer to the matching custom profile_key from the transcript.",
  }

  let sessionRowId: string
  let sessionApplicantIdentity: ApplicantIdentity | null =
    input.applicantIdentity ?? null
  let currentStepId: string | null = null
  let flowVersion: string | null = null
  let onboardingState: OnboardingState = {}

  let existing: {
    id: string
    status: string
    current_step_id: string | null
    flow_version: string | null
    applicant_email?: string | null
    applicant_name?: string | null
    onboarding_state?: unknown
  } | null = null

  const sessionSelect = await supabase
    .from("sessions")
    .select(
      "id, status, current_step_id, flow_version, applicant_email, applicant_name, onboarding_state",
    )
    .eq("session_id", sessionId)
    .eq("project_id", projectId)
    .maybeSingle()

  if (sessionSelect.error?.message?.includes("onboarding_state")) {
    const fallback = await supabase
      .from("sessions")
      .select("id, status, current_step_id, flow_version, applicant_email, applicant_name")
      .eq("session_id", sessionId)
      .eq("project_id", projectId)
      .maybeSingle()
    existing = fallback.data
  } else {
    existing = sessionSelect.data
  }

  if (existing) {
    if (isConcludedSessionStatus(existing.status)) {
      return traceJson(input, { error: "Session concluded" }, { status: 409 })
    }
    if (
      input.applicantIdentity?.email &&
      existing.applicant_email &&
      existing.applicant_email !== input.applicantIdentity.email
    ) {
      return traceJson(
        input,
        { error: "Applicant identity does not match this session" },
        { status: 409 },
      )
    }
    if (input.applicantIdentity && !existing.applicant_email) {
      await supabase
        .from("sessions")
        .update(applicantIdentityPayload(input.applicantIdentity))
        .eq("id", existing.id)
    }
    sessionRowId = existing.id
    sessionApplicantIdentity =
      input.applicantIdentity ?? applicantIdentityFromRow(existing)
    currentStepId = existing.current_step_id ?? null
    flowVersion = existing.flow_version ?? flow.version
    onboardingState = parseOnboardingState(existing.onboarding_state)
  } else {
    if (!input.applicantIdentity && !input.projectId) {
      return traceJson(
        input,
        { error: "applicant.email is required to start a session" },
        { status: 400 },
      )
    }
    const { data: created, error: createError } = await supabase
      .from("sessions")
      .insert({
        session_id: sessionId,
        persona_id: resolvedPersonaId,
        organisation_id: organisationId,
        project_id: projectId,
        flow_version: flow.version,
        current_step_id: null,
        onboarding_state: null,
        ...applicantIdentityPayload(input.applicantIdentity),
      })
      .select("id")
      .single()

    if (createError || !created) {
      log.error("onboarding_session_create_failed", {
        requestId: input.requestId,
        projectId,
        detail: createError?.message,
      })
      return traceJson(input, { error: "Database error" }, { status: 500 })
    }
    sessionRowId = created.id
    flowVersion = flow.version
  }

  let assistantContent = DEFAULT_CLOSING
  let nextCurrentStepId: string | null = null
  let terminal = false
  let onboardingFlags: { followup?: boolean; boundary?: boolean } | undefined
  let stepHint: string | undefined

  const userTrimmed = message.trim()

  if (currentStepId === null) {
    const { error: userMsgError } = await supabase.from("messages").insert({
      session_id: sessionRowId,
      organisation_id: organisationId,
      project_id: projectId,
      role: "user",
      content: userTrimmed,
      metadata: {},
    })
    if (userMsgError) {
      return traceJson(input, { error: "Database error" }, { status: 500 })
    }

    assistantContent = formatStepPrompt(steps[0], welcome)
    nextCurrentStepId = steps[0].id
    stepHint = steps[0].hint
  } else {
    const idx = stepIndex(steps, currentStepId)
    if (idx < 0) {
      return traceJson(input, { error: "Invalid session step state" }, { status: 500 })
    }

    const stepAnswered = steps[idx]
    const inFollowup =
      onboardingState.followup_step_id === currentStepId

    const { error: userMsgError } = await supabase.from("messages").insert({
      session_id: sessionRowId,
      organisation_id: organisationId,
      project_id: projectId,
      role: "user",
      content: userTrimmed,
      metadata: {
        onboarding_step_id: currentStepId,
        ...(inFollowup ? { onboarding_followup: true } : {}),
      },
    })
    if (userMsgError) {
      return traceJson(input, { error: "Database error" }, { status: 500 })
    }

    const next = steps[idx + 1]
    let newOnboardingState: OnboardingState | null = null
    let decided = false

    const useIntelligence =
      experience.bridge_enabled || experience.boundary_enabled

    if (useIntelligence) {
      const intel = await runOnboardingTurnIntelligence({
        personaPrompt,
        stepAnswered,
        userAnswer: userTrimmed,
        nextStep: next ?? null,
        boundaryEnabled: experience.boundary_enabled,
        followupEnabled: experience.followup_enabled && !inFollowup,
        alreadyInFollowup: inFollowup,
        requestId: input.requestId,
        organisationId,
        projectId,
        sessionId,
      })

      if (intel?.action === "boundary" && experience.boundary_enabled) {
        assistantContent = intel.reply || BOUNDARY_REPLY
        nextCurrentStepId = currentStepId
        onboardingFlags = { boundary: true }
        newOnboardingState = null
        decided = true
      } else if (
        intel?.action === "followup" &&
        experience.followup_enabled &&
        !inFollowup
      ) {
        assistantContent = intel.reply || defaultFollowupPrompt(stepAnswered)
        nextCurrentStepId = currentStepId
        onboardingFlags = { followup: true }
        newOnboardingState = { followup_step_id: currentStepId }
        decided = true
      } else if (intel?.action === "continue") {
        if (next) {
          assistantContent = intel.reply
          nextCurrentStepId = next.id
          stepHint = next.hint
        } else {
          terminal = true
          assistantContent = intel.reply
          nextCurrentStepId = null
        }
        newOnboardingState = null
        decided = true
      }
    }

    if (!decided) {
      if (
        experience.followup_enabled &&
        !inFollowup &&
        shouldHeuristicFollowup(
          stepAnswered,
          userTrimmed,
          inFollowup,
          experience.followup_enabled,
        )
      ) {
        assistantContent = defaultFollowupPrompt(stepAnswered)
        nextCurrentStepId = currentStepId
        onboardingFlags = { followup: true }
        newOnboardingState = { followup_step_id: currentStepId }
      } else if (next) {
        if (experience.bridge_enabled) {
          const intel = await runOnboardingTurnIntelligence({
            personaPrompt,
            stepAnswered,
            userAnswer: userTrimmed,
            nextStep: next,
            boundaryEnabled: false,
            followupEnabled: false,
            alreadyInFollowup: inFollowup,
            requestId: input.requestId,
            organisationId,
            projectId,
            sessionId,
          })
          assistantContent =
            intel?.reply ?? fallbackBridgeReply(next, undefined)
        } else {
          assistantContent = verbatimNextMessage(next)
        }
        nextCurrentStepId = next.id
        stepHint = next.hint
        newOnboardingState = null
      } else {
        terminal = true
        nextCurrentStepId = null
        newOnboardingState = null
      }
    }

    await supabase
      .from("sessions")
      .update({
        onboarding_state:
          newOnboardingState && Object.keys(newOnboardingState).length > 0
            ? newOnboardingState
            : null,
      })
      .eq("id", sessionRowId)
  }

  if (terminal) {
    const { data: history } = await supabase
      .from("messages")
      .select("role, content")
      .eq("session_id", sessionRowId)
      .order("sent_at", { ascending: true })

    const transcript: ConversationMessage[] = (history ?? []).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }))

    if (experience.personalized_completion) {
      assistantContent = await generateOnboardingCompletion(
        personaPrompt,
        transcript,
        {
          requestId: input.requestId,
          organisationId,
          projectId,
          sessionId,
        },
      )
    } else {
      assistantContent = DEFAULT_CLOSING
    }

    await supabase.from("messages").insert({
      session_id: sessionRowId,
      organisation_id: organisationId,
      project_id: projectId,
      role: "assistant",
      content: assistantContent,
      metadata: { onboarding_complete: true },
    })

    const successSecret = randomUUID()
    await supabase
      .from("sessions")
      .update({
        status: "passed",
        success_secret: successSecret,
        current_step_id: null,
        flow_version: flowVersion,
        onboarding_state: null,
      })
      .eq("id", sessionRowId)

    let profile: Awaited<
      ReturnType<typeof recordVerdictAndEnqueueWebhooks>
    >["profile"] = null

    try {
      const result = await recordVerdictAndEnqueueWebhooks({
        organisationId,
        projectId,
        sessionInternalId: sessionRowId,
        clientSessionKey: sessionId,
        terminalStatus: "passed",
        scores: NEUTRAL_SCORES,
        requestId: input.requestId,
        persona: mergedPersona,
        transcript,
        applicant: sessionApplicantIdentity,
      })
      profile = result?.profile ?? null
    } catch (err) {
      log.error("onboarding_verdict_failed", {
        requestId: input.requestId,
        projectId,
        sessionId,
        detail: err instanceof Error ? err.message : String(err),
      })
    }

    return traceJson(input, {
      message: assistantContent,
      status: "passed",
      scores: NEUTRAL_SCORES,
      secret: successSecret,
      projectType: "onboarding",
      flowVersion,
      ...(profile ? { profile } : {}),
    })
  }

  await supabase.from("messages").insert({
    session_id: sessionRowId,
    organisation_id: organisationId,
    project_id: projectId,
    role: "assistant",
    content: assistantContent,
    metadata: { onboarding_step_id: nextCurrentStepId },
  })

  await supabase
    .from("sessions")
    .update({
      current_step_id: nextCurrentStepId,
      flow_version: flowVersion,
    })
    .eq("id", sessionRowId)

  const currentStep = nextCurrentStepId
    ? currentStepPayload(steps, nextCurrentStepId)
    : null

  return traceJson(input, {
    message: assistantContent,
    status: "active",
    scores: NEUTRAL_SCORES,
    projectType: "onboarding",
    flowVersion,
    ...(currentStep ? { currentStep } : {}),
    ...(stepHint ? { stepHint } : {}),
    ...(onboardingFlags ? { onboardingFlags } : {}),
  })
}
