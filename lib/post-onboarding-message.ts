import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import type { ConversationMessage } from "@/lib/scoring"
import { log } from "@/lib/logger"
import { REQUEST_ID_HEADER } from "@/lib/request-trace"
import { supabase } from "@/lib/supabase"
import {
  buildOnboardingProfileSchema,
  type NormalizedProjectSettings,
  type OnboardingFlowStep,
} from "@/lib/project-settings"
import type { ProjectContext } from "@/lib/project-resolution"
import { touchApiKeyLastUsed } from "@/lib/project-resolution"
import { recordVerdictAndEnqueueWebhooks } from "@/lib/verdict-webhook"
import type { PostSessionMessageInput } from "@/lib/post-session-message"

const NEUTRAL_SCORES = {
  specificity: 0.5,
  authenticity: 0.5,
  cultural_depth: 0.5,
  overall: 0.5,
}

function traceJson(
  input: PostSessionMessageInput,
  body: unknown,
  init?: ResponseInit,
): NextResponse {
  const headers = new Headers(init?.headers)
  if (input.requestId) headers.set(REQUEST_ID_HEADER, input.requestId)
  return NextResponse.json(body, { ...init, headers })
}

const CONCLUDED = ["passed", "failed", "redirected", "rejected"]

function stepIndex(steps: OnboardingFlowStep[], stepId: string): number {
  return steps.findIndex((s) => s.id === stepId)
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
  const flow = input.projectSettings.flowConfig

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

  if (apiKeyId) touchApiKeyLastUsed(apiKeyId)

  let resolvedPersonaId: string | null = null
  const settingsPersonaId =
    typeof input.projectSettings.raw.persona_id === "string"
      ? input.projectSettings.raw.persona_id
      : null
  const personaLookupId = personaId?.trim() || settingsPersonaId

  type PersonaRow = {
    id: string
    profile_schema?: unknown
    profile_extractor_hint?: string | null
  }

  let personaForExtraction: PersonaRow | null = null
  const personaCols = "id, profile_schema, profile_extractor_hint"

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

  const onboardingSchema = buildOnboardingProfileSchema(steps)
  const mergedPersona = {
    profile_schema:
      personaForExtraction?.profile_schema ?? onboardingSchema,
    profile_extractor_hint:
      personaForExtraction?.profile_extractor_hint ??
      "Map each onboarding step answer to the matching custom profile_key from the transcript.",
  }

  let sessionRowId: string
  let currentStepId: string | null = null
  let flowVersion: string | null = null

  const { data: existing } = await supabase
    .from("sessions")
    .select("id, status, current_step_id, flow_version")
    .eq("session_id", sessionId)
    .eq("project_id", projectId)
    .maybeSingle()

  if (existing) {
    if (CONCLUDED.includes(existing.status)) {
      return traceJson(input, { error: "Session concluded" }, { status: 409 })
    }
    sessionRowId = existing.id
    currentStepId = existing.current_step_id ?? null
    flowVersion = existing.flow_version ?? flow.version
  } else {
    const { data: created, error: createError } = await supabase
      .from("sessions")
      .insert({
        session_id: sessionId,
        persona_id: resolvedPersonaId,
        organisation_id: organisationId,
        project_id: projectId,
        flow_version: flow.version,
        current_step_id: null,
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

  const { data: userMsg, error: userMsgError } = await supabase
    .from("messages")
    .insert({
      session_id: sessionRowId,
      organisation_id: organisationId,
      project_id: projectId,
      role: "user",
      content: message.trim(),
      metadata:
        currentStepId !== null
          ? { onboarding_step_id: currentStepId }
          : {},
    })
    .select("id")
    .single()

  if (userMsgError || !userMsg) {
    return traceJson(input, { error: "Database error" }, { status: 500 })
  }

  let assistantContent: string
  let nextCurrentStepId: string | null
  let terminal = false

  if (currentStepId === null) {
    assistantContent = steps[0].question
    nextCurrentStepId = steps[0].id
  } else {
    const idx = stepIndex(steps, currentStepId)
    if (idx < 0) {
      return traceJson(input, { error: "Invalid session step state" }, { status: 500 })
    }
    const next = steps[idx + 1]
    if (next) {
      assistantContent = next.question
      nextCurrentStepId = next.id
    } else {
      terminal = true
      assistantContent =
        "Thanks — you're all set. We'll use what you shared to personalise your experience."
      nextCurrentStepId = null
    }
  }

  await supabase.from("messages").insert({
    session_id: sessionRowId,
    organisation_id: organisationId,
    project_id: projectId,
    role: "assistant",
    content: assistantContent,
    metadata: terminal
      ? { onboarding_complete: true }
      : { onboarding_step_id: nextCurrentStepId },
  })

  if (!terminal) {
    await supabase
      .from("sessions")
      .update({
        current_step_id: nextCurrentStepId,
        flow_version: flowVersion,
      })
      .eq("id", sessionRowId)

    return traceJson(input, {
      message: assistantContent,
      status: "active",
      scores: NEUTRAL_SCORES,
      projectType: "onboarding",
      flowVersion,
      currentStep: {
        id: nextCurrentStepId,
        title: steps.find((s) => s.id === nextCurrentStepId)?.title ?? "",
        index: stepIndex(steps, nextCurrentStepId!),
        total: steps.length,
      },
    })
  }

  const { data: history } = await supabase
    .from("messages")
    .select("role, content")
    .eq("session_id", sessionRowId)
    .order("sent_at", { ascending: true })

  const transcript: ConversationMessage[] = (history ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }))

  const successSecret = randomUUID()
  await supabase
    .from("sessions")
    .update({
      status: "passed",
      success_secret: successSecret,
      current_step_id: null,
      flow_version: flowVersion,
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
      persona: mergedPersona,
      transcript,
    })
    profile = result?.profile ?? null
    if (profile) {
      await supabase
        .from("sessions")
        .update({ profile })
        .eq("id", sessionRowId)
    }
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
