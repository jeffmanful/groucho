import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { log } from "@/lib/logger"
import { requireOrgAdmin, unauthorized } from "@/lib/org-access"
import {
  extractProfile,
  summariseProfileForLog,
  type PersonaForExtraction,
} from "@/lib/profile-extraction"
import { getOrCreateRequestId } from "@/lib/request-trace"
import type { ConversationMessage } from "@/lib/scoring"
import { supabase } from "@/lib/supabase"

const MAX_TRANSCRIPT_MESSAGES = 200

export async function POST(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ orgId: string; projectId: string; sessionId: string }>
  },
) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()

  const { orgId, projectId, sessionId } = await params
  const deny = await requireOrgAdmin(actor, orgId)
  if (deny) return deny

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, persona_id")
    .eq("id", sessionId)
    .eq("project_id", projectId)
    .eq("organisation_id", orgId)
    .maybeSingle()

  if (sessionError || !session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const { data: messageRows, error: messagesError } = await supabase
    .from("messages")
    .select("role, content")
    .eq("session_id", sessionId)
    .order("sent_at", { ascending: true })
    .limit(MAX_TRANSCRIPT_MESSAGES)

  if (messagesError) {
    console.error("manual profile transcript:", messagesError)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  const transcript: ConversationMessage[] = (messageRows ?? [])
    .filter(
      (message): message is { role: "assistant" | "user"; content: string } =>
        (message.role === "assistant" || message.role === "user") &&
        typeof message.content === "string",
    )
    .map((message) => ({ role: message.role, content: message.content }))

  if (!transcript.some((message) => message.role === "user")) {
    return NextResponse.json(
      { error: "The session needs at least one applicant message before a profile can be generated" },
      { status: 422 },
    )
  }

  let persona: PersonaForExtraction | null = null
  if (session.persona_id) {
    const { data: personaRow } = await supabase
      .from("personas")
      .select("profile_schema, profile_extractor_hint")
      .eq("id", session.persona_id)
      .maybeSingle()
    if (personaRow) {
      persona = {
        profile_schema: personaRow.profile_schema ?? null,
        profile_extractor_hint: personaRow.profile_extractor_hint ?? null,
      }
    }
  }

  const requestId = getOrCreateRequestId(req)
  const profile = await extractProfile({
    transcript,
    persona,
    requestId,
    organisationId: orgId,
    projectId,
    sessionId,
    terminalStatus: "manual",
  })
  const extractedAt = new Date().toISOString()

  const { error: writeError } = await supabase
    .from("sessions")
    .update({ profile, profile_extracted_at: extractedAt })
    .eq("id", sessionId)
    .eq("project_id", projectId)
    .eq("organisation_id", orgId)

  if (writeError) {
    log.error("manual_profile_write_failed", {
      requestId,
      organisationId: orgId,
      projectId,
      sessionId,
      detail: writeError.message,
    })
    return NextResponse.json({ error: "Could not save profile" }, { status: 500 })
  }

  log.info("manual_profile_extracted", {
    requestId,
    organisationId: orgId,
    projectId,
    sessionId,
    ...summariseProfileForLog(profile),
  })

  if (profile.extraction.status === "failed") {
    return NextResponse.json(
      {
        error: "Profile extraction failed",
        detail: profile.extraction.reason,
        profile,
        profileExtractedAt: extractedAt,
      },
      { status: 502 },
    )
  }

  return NextResponse.json({ profile, profileExtractedAt: extractedAt })
}
