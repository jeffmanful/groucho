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
import type { NormalizedProjectSettings } from "@/lib/project-settings"
import {
  resolveGatekeeperOpeningInteraction,
  resolveGatekeeperOpeningMessage,
} from "@/lib/opening-message"
import {
  DEFAULT_INTERACTION_SPEC,
  type GrouchoInteractionSpec,
} from "@/lib/gatekeeper-interaction-spec"
import type { PostSessionMessageInput } from "@/lib/post-session-message"
import { isConcludedSessionStatus } from "@/lib/session-status"
import {
  applicationOpeningMessageForSignals,
  applicationSignalDefinitions,
  applicationSignalMetadata,
  isColorsForumSignalSet,
} from "@/lib/application-signal-state"

function traceJson(
  input: Pick<PostSessionMessageInput, "requestId">,
  body: unknown,
  init?: ResponseInit,
): NextResponse {
  const headers = new Headers(init?.headers)
  if (input.requestId) headers.set(REQUEST_ID_HEADER, input.requestId)
  return NextResponse.json(body, { ...init, headers })
}

export type StartGatekeeperSessionInput = {
  sessionId: string
  personaId?: string
  applicantIdentity?: ApplicantIdentity | null
  openingMessage?: string
  openingInteraction?: GrouchoInteractionSpec
  allowMissingApplicantIdentity?: boolean
  requestId?: string
  context: ProjectContext
  projectSettings: NormalizedProjectSettings
}

async function resolvePersonaId(
  input: StartGatekeeperSessionInput,
): Promise<string | null> {
  const settingsPersonaId =
    typeof input.projectSettings.raw.persona_id === "string"
      ? input.projectSettings.raw.persona_id
      : null
  const personaLookupId = input.personaId?.trim() || settingsPersonaId

  if (personaLookupId) {
    const { data } = await supabase
      .from("personas")
      .select("id")
      .eq("id", personaLookupId)
      .eq("is_active", true)
      .maybeSingle()
    if (data?.id) return data.id
  }

  const { data } = await supabase
    .from("personas")
    .select("id")
    .eq("is_active", true)
    .eq("is_default", true)
    .maybeSingle()
  return data?.id ?? null
}

export async function startGatekeeperSession(
  input: StartGatekeeperSessionInput,
): Promise<NextResponse> {
  const {
    sessionId,
    context,
    projectSettings,
    applicantIdentity,
    allowMissingApplicantIdentity,
  } = input
  const { organisationId, projectId, apiKeyId } = context
  const openingSignals = applicationSignalDefinitions(
    projectSettings.applicationExperience.required_signals,
  )
  const configuredOpeningMessage = resolveGatekeeperOpeningMessage(
    input.openingMessage,
    projectSettings.applicationExperience.opening_message,
  )
  const openingMessage = applicationOpeningMessageForSignals(
    configuredOpeningMessage,
    openingSignals,
  )
  const configuredOpeningInteraction = resolveGatekeeperOpeningInteraction(
    input.openingInteraction,
    projectSettings.applicationExperience.opening_interaction,
  )
  const openingInteraction = isColorsForumSignalSet(openingSignals)
    ? {
        ...DEFAULT_INTERACTION_SPEC,
        inputType: "text" as const,
        visualState: "curious" as const,
      }
    : configuredOpeningInteraction
  const openingSignal = openingSignals[0] ?? null

  if (apiKeyId) touchApiKeyLastUsed(apiKeyId)

  const resolvedPersonaId = await resolvePersonaId(input)

  const { data: existing } = await supabase
    .from("sessions")
    .select("id, status, applicant_email, applicant_name")
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
      .select("role, content, metadata")
      .eq("session_id", existing.id)
      .eq("role", "assistant")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    const lastAssistant =
      lastMsg?.role === "assistant" ? lastMsg.content : openingMessage
    const lastUi =
      lastMsg?.metadata &&
      typeof lastMsg.metadata === "object" &&
      "ui" in lastMsg.metadata
        ? (lastMsg.metadata.ui as GrouchoInteractionSpec)
        : openingInteraction

    return traceJson(input, {
      message: lastAssistant,
      status: "active",
      projectType: "gatekeeper",
      ui: lastUi,
      bootstrapped: true,
      resumed: true,
    })
  }

  if (!applicantIdentity && !allowMissingApplicantIdentity) {
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
      ...applicantIdentityPayload(applicantIdentity),
    })
    .select("id")
    .single()

  if (createError?.code === "23505") {
    const { data: raced } = await supabase
      .from("sessions")
      .select("id, status, applicant_email, applicant_name")
      .eq("session_id", sessionId)
      .eq("project_id", projectId)
      .maybeSingle()
    if (raced && !isConcludedSessionStatus(raced.status)) {
      const { data: lastMsg } = await supabase
        .from("messages")
        .select("role, content, metadata")
        .eq("session_id", raced.id)
        .eq("role", "assistant")
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      const lastAssistant =
        lastMsg?.role === "assistant" ? lastMsg.content : openingMessage
      const lastUi =
        lastMsg?.metadata &&
        typeof lastMsg.metadata === "object" &&
        "ui" in lastMsg.metadata
          ? (lastMsg.metadata.ui as GrouchoInteractionSpec)
          : openingInteraction
      return traceJson(input, {
        message: lastAssistant,
        status: "active",
        projectType: "gatekeeper",
        ui: lastUi,
        bootstrapped: true,
        resumed: true,
      })
    }
  }

  if (createError || !created) {
    log.error("gatekeeper_start_session_create_failed", {
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
    content: openingMessage,
    metadata: {
      gatekeeper_bootstrap: true,
      ui: openingInteraction,
      ...(openingSignal
        ? { application_next_signal: applicationSignalMetadata(openingSignal) }
        : {}),
    },
  })

  return traceJson(input, {
    message: openingMessage,
    status: "active",
    projectType: "gatekeeper",
    ui: openingInteraction,
    bootstrapped: true,
    resumed: false,
  })
}
