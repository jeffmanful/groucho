import { NextResponse } from "next/server"
import {
  applicantIdentityPayload,
  type ApplicantIdentity,
} from "@/lib/applicant-identity"
import { log } from "@/lib/logger"
import { REQUEST_ID_HEADER } from "@/lib/request-trace"
import { supabase } from "@/lib/supabase"
import type { ProjectContext } from "@/lib/project-resolution"
import { touchApiKeyLastUsed } from "@/lib/project-resolution"
import {
  formatStepPrompt,
  resolveRuntimeFlowConfig,
  type NormalizedProjectSettings,
  type OnboardingFlowStep,
} from "@/lib/project-settings"
import type { PostSessionMessageInput } from "@/lib/post-session-message"
import { isConcludedSessionStatus } from "@/lib/session-status"

function traceJson(
  input: Pick<PostSessionMessageInput, "requestId">,
  body: unknown,
  init?: ResponseInit,
): NextResponse {
  const headers = new Headers(init?.headers)
  if (input.requestId) headers.set(REQUEST_ID_HEADER, input.requestId)
  return NextResponse.json(body, { ...init, headers })
}

function currentStepPayload(steps: OnboardingFlowStep[], stepId: string) {
  const idx = steps.findIndex((s) => s.id === stepId)
  if (idx < 0) return null
  return {
    id: steps[idx].id,
    title: steps[idx].title,
    index: idx,
    total: steps.length,
    ...(steps[idx].interaction ? { interaction: steps[idx].interaction } : {}),
  }
}

export type StartOnboardingSessionInput = {
  sessionId: string
  personaId?: string
  applicantIdentity?: ApplicantIdentity | null
  allowMissingApplicantIdentity?: boolean
  requestId?: string
  context: ProjectContext
  projectSettings: NormalizedProjectSettings
}

export async function startOnboardingSession(
  input: StartOnboardingSessionInput,
): Promise<NextResponse> {
  const {
    sessionId,
    context,
    projectSettings,
    applicantIdentity,
    allowMissingApplicantIdentity,
  } = input
  const { organisationId, projectId, apiKeyId } = context
  const flow = resolveRuntimeFlowConfig(projectSettings)

  if (!flow || flow.steps.length === 0) {
    return traceJson(
      input,
      { error: "Onboarding flow is not configured for this project" },
      { status: 500 },
    )
  }

  const activeFlow = flow
  const steps = activeFlow.steps
  const welcome = activeFlow.welcome_message?.trim() || undefined

  if (apiKeyId) touchApiKeyLastUsed(apiKeyId)

  let resolvedPersonaId: string | null = null
  const settingsPersonaId =
    typeof projectSettings.raw.persona_id === "string"
      ? projectSettings.raw.persona_id
      : null
  const personaLookupId = input.personaId?.trim() || settingsPersonaId

  if (personaLookupId) {
    const { data } = await supabase
      .from("personas")
      .select("id")
      .eq("id", personaLookupId)
      .eq("is_active", true)
      .maybeSingle()
    resolvedPersonaId = data?.id ?? null
  }
  if (!resolvedPersonaId) {
    const { data } = await supabase
      .from("personas")
      .select("id")
      .eq("is_active", true)
      .eq("is_default", true)
      .maybeSingle()
    resolvedPersonaId = data?.id ?? null
  }

  const firstStep = steps[0]
  const bootstrapMessage = formatStepPrompt(firstStep, welcome)

  const { data: existing } = await supabase
    .from("sessions")
    .select("id, status, current_step_id, flow_version, applicant_email, applicant_name")
    .eq("session_id", sessionId)
    .eq("project_id", projectId)
    .maybeSingle()

  if (existing) {
    if (isConcludedSessionStatus(existing.status)) {
      return traceJson(input, { error: "Session concluded" }, { status: 409 })
    }
    if (
      applicantIdentity?.email &&
      existing.applicant_email &&
      existing.applicant_email !== applicantIdentity.email
    ) {
      return traceJson(
        input,
        { error: "Applicant identity does not match this session" },
        { status: 409 },
      )
    }
    if (applicantIdentity && !existing.applicant_email) {
      await supabase
        .from("sessions")
        .update(applicantIdentityPayload(applicantIdentity))
        .eq("id", existing.id)
    }

    const { data: lastMsg } = await supabase
      .from("messages")
      .select("role, content")
      .eq("session_id", existing.id)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    const lastAssistant =
      lastMsg?.role === "assistant"
        ? lastMsg.content
        : bootstrapMessage

    const stepId = existing.current_step_id ?? firstStep.id
    const currentStep = currentStepPayload(steps, stepId)

    return traceJson(input, {
      message: lastAssistant,
      status: "active",
      projectType: "onboarding",
      flowVersion: existing.flow_version ?? activeFlow.version,
      ...(welcome ? { welcomeMessage: welcome } : {}),
      ...(currentStep ? { currentStep } : {}),
      stepHint: steps.find((s) => s.id === stepId)?.hint,
      bootstrapped: true,
      resumed: true,
    })
  }

  async function insertSession(includeOnboardingState: boolean) {
    if (!applicantIdentity && !allowMissingApplicantIdentity) {
      return {
        data: null,
        error: {
          code: "GROUCHO_APPLICANT_REQUIRED",
          message: "applicant.email is required to start a session",
        },
      }
    }
    const row: Record<string, unknown> = {
      session_id: sessionId,
      persona_id: resolvedPersonaId,
      organisation_id: organisationId,
      project_id: projectId,
      flow_version: activeFlow.version,
      current_step_id: firstStep.id,
      ...applicantIdentityPayload(applicantIdentity),
    }
    if (includeOnboardingState) row.onboarding_state = null
    return supabase.from("sessions").insert(row).select("id").single()
  }

  let { data: created, error: createError } = await insertSession(true)

  if (
    createError &&
    (createError.message?.includes("onboarding_state") ||
      createError.code === "42703")
  ) {
    ;({ data: created, error: createError } = await insertSession(false))
  }

  if (createError?.code === "GROUCHO_APPLICANT_REQUIRED") {
    return traceJson(input, { error: createError.message }, { status: 400 })
  }

  if (createError?.code === "23505") {
    const { data: raced } = await supabase
      .from("sessions")
      .select("id, status, current_step_id, flow_version, applicant_email, applicant_name")
      .eq("session_id", sessionId)
      .eq("project_id", projectId)
      .maybeSingle()
    if (raced && !isConcludedSessionStatus(raced.status)) {
      const { data: lastMsg } = await supabase
        .from("messages")
        .select("role, content")
        .eq("session_id", raced.id)
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      const lastAssistant =
        lastMsg?.role === "assistant" ? lastMsg.content : bootstrapMessage
      const stepId = raced.current_step_id ?? firstStep.id
      const currentStep = currentStepPayload(steps, stepId)
      return traceJson(input, {
        message: lastAssistant,
        status: "active",
        projectType: "onboarding",
        flowVersion: raced.flow_version ?? activeFlow.version,
        ...(welcome ? { welcomeMessage: welcome } : {}),
        ...(currentStep ? { currentStep } : {}),
        stepHint: steps.find((s) => s.id === stepId)?.hint,
        bootstrapped: true,
        resumed: true,
      })
    }
  }

  if (createError || !created) {
    log.error("onboarding_start_session_create_failed", {
      requestId: input.requestId,
      projectId,
      detail: createError?.message,
      code: createError?.code,
    })
    return traceJson(
      input,
      {
        error: "Database error",
        detail:
          process.env.NODE_ENV === "development"
            ? createError?.message
            : undefined,
      },
      { status: 500 },
    )
  }

  await supabase.from("messages").insert({
    session_id: created.id,
    organisation_id: organisationId,
    project_id: projectId,
    role: "assistant",
    content: bootstrapMessage,
    metadata: { onboarding_step_id: firstStep.id, onboarding_bootstrap: true },
  })

  const currentStep = currentStepPayload(steps, firstStep.id)

  return traceJson(input, {
    message: bootstrapMessage,
    status: "active",
    projectType: "onboarding",
    flowVersion: activeFlow.version,
    ...(welcome ? { welcomeMessage: welcome } : {}),
    ...(currentStep ? { currentStep } : {}),
    stepHint: firstStep.hint,
    bootstrapped: true,
    resumed: false,
  })
}
