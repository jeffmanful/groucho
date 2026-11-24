import { NextRequest, NextResponse } from "next/server"
import { createHash, randomUUID } from "node:crypto"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requireOrgAdmin, unauthorized } from "@/lib/org-access"
import { isSameOriginMutation } from "@/lib/platform-admin-access"
import { checkRateLimit } from "@/lib/rate-limit"
import { postConversation, type ConversationTranscriptEntry } from "@/lib/conversation-engine"
import { readProjectConversation, validateProjectConversation, projectConversationOpening, projectConversationReplyStyle, projectConversationSettings } from "@/lib/project-conversation-config"
import { projectConversationConfiguration, projectConversationProfile, projectConversationRevision } from "@/lib/project-conversation-runtime"
import { signProjectPreview, verifyProjectPreview } from "@/lib/project-conversation-preview"
import { normalizeProjectSettings } from "@/lib/project-settings"
import { emptySignalEvidence } from "@/lib/project-conversation-evidence"
import { DEFAULT_INTERACTION_SPEC } from "@/lib/gatekeeper-interaction-spec"
import { supabase } from "@/lib/supabase"

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } })
const projectUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const savedPreviewId = /^[0-9a-f]{64}$/
const previewTable = "saved_project_conversation_previews"
const previewListColumns = "id, created_at, status, answer_count"
const previewPageSize = 20

async function findProject(orgId: string, projectId: string) {
  const { data, error } = await supabase.from("projects").select("id, settings")
    .eq("id", projectId).eq("organisation_id", orgId).maybeSingle()
  if (error) throw error
  return data
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const actor = await resolveAdminActor()
    if (!actor) return unauthorized()
    const { orgId } = await params
    const deny = await requireOrgAdmin(actor, orgId)
    if (deny) return deny
    const projectId = req.nextUrl.searchParams.get("projectId")
    const previewId = req.nextUrl.searchParams.get("previewId")
    if (!projectId || !projectUuid.test(projectId) || (previewId !== null && !savedPreviewId.test(previewId))) {
      return json({ error: "Invalid project or preview." }, 400)
    }
    if (!await findProject(orgId, projectId)) return json({ error: "Project not found." }, 404)
    if (previewId) {
      const { data, error } = await supabase.from(previewTable)
        .select(previewListColumns + ", config, reply_style, transcript, signal_evidence, settings_conflict")
        .eq("project_id", projectId).eq("id", previewId).maybeSingle()
      if (error) throw error
      return data ? json({ savedPreview: data }) : json({ error: "Saved preview not found." }, 404)
    }
    const page = Number(req.nextUrl.searchParams.get("page") ?? "0")
    if (!Number.isSafeInteger(page) || page < 0 || page > 100000) return json({ error: "Invalid preview page." }, 400)
    const offset = page * previewPageSize
    const { data, error } = await supabase.from(previewTable).select(previewListColumns)
      .eq("project_id", projectId).order("created_at", { ascending: false }).order("id").range(offset, offset + previewPageSize)
    if (error) throw error
    return json({ savedPreviews: data.slice(0, previewPageSize), hasOlder: data.length > previewPageSize })
  } catch {
    return json({ error: "Saved previews are unavailable. Please retry." }, 503)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    if (!isSameOriginMutation(req)) return json({ error: "Invalid request origin." }, 403)
    const actor = await resolveAdminActor()
    if (!actor) return unauthorized()
    const { orgId } = await params
    const deny = await requireOrgAdmin(actor, orgId)
    if (deny) return deny
    const actorId = actor.kind === "platform" ? `platform:${actor.email}` : `member:${actor.userId}`
    if (!checkRateLimit({ namespace: "project-conversation-preview", key: `${orgId}:${actorId}`, limit: 30, windowMs: 60_000 }).ok) return json({ error: "Please wait a minute before trying again." }, 429)
    const raw = await req.text()
    if (raw.length > 400_000) return json({ error: "Preview request is too large. Start a new preview." }, 413)
    let body
    try { body = JSON.parse(raw) } catch { return json({ error: "Invalid request." }, 400) }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request." }, 400)
    if (body.action === "start") {
      const validated = validateProjectConversation(body.config)
      if (!validated.ok) return json({ error: validated.error }, 400)
      const config = validated.config
      const projectId = typeof body.projectId === "string" && projectUuid.test(body.projectId) ? body.projectId.toLowerCase() : undefined
      const runtime = projectConversationConfiguration(config, { organisationId: orgId, projectId: projectId ?? "preview" })
      const message = projectConversationOpening(config)
      const profile = projectConversationProfile(config)
      const choice = profile.openingChoice ? profile.choices[profile.openingChoice] : undefined
      const signalTurn = config.version === 2 && config.signals.length ? { questionSignalId: profile.openingSignalId ?? null, followUp: false, changes: [] } : undefined
      const ui = { ...DEFAULT_INTERACTION_SPEC, ...(choice ? { inputType: choice.inputType ?? "singleSelect", options: [...choice.options] } : {}) }
      const transcript: ConversationTranscriptEntry[] = [{ role: "assistant", content: message, metadata: {
        conversation_engine: runtime.marker, conversation_profile: runtime.id, ...(profile.openingChoice ? { conversation_choice_key: profile.openingChoice } : {}),
        ...(signalTurn ? { conversation_signal_turn: signalTurn } : {}), ui,
      } }]
      return json({ message, status: "active", ui, ...(signalTurn ? { signalTurn } : {}), ...(config.version === 2 ? { signalEvidence: emptySignalEvidence(config.signals) } : {}), token: signProjectPreview({
        organisationId: orgId, ...(projectId ? { projectId } : {}), actor: actorId, expiresAt: Date.now() + 60 * 60_000, config, transcript, status: "active",
      }) })
    }
    if ((body.action !== "message" && body.action !== "save") || typeof body.token !== "string") return json({ error: "Start a preview first." }, 400)
    const preview = verifyProjectPreview(body.token, orgId, actorId)
    if (!preview) return json({ error: "Preview expired or changed. Start a new preview." }, 409)
    if (body.action === "save") {
      const projectId = typeof body.projectId === "string" && projectUuid.test(body.projectId) ? body.projectId.toLowerCase() : undefined
      if (!projectId) return json({ error: "Choose a project for this preview." }, 400)
      if (preview.projectId && preview.projectId !== projectId) return json({ error: "This preview belongs to a different project." }, 409)
      const project = await findProject(orgId, projectId)
      if (!project) return json({ error: "Project not found." }, 404)
      if (!preview.projectId) {
        const storedConfig = readProjectConversation(project.settings)
        if (!storedConfig || projectConversationRevision(storedConfig) !== projectConversationRevision(preview.config)) {
          return json({ error: "Save the tested configuration to this project before saving its preview." }, 409)
        }
      }
      const transcript = preview.transcript
        .filter(entry => entry.role === "user" || entry.role === "assistant")
        .map(({ role, content, metadata }) => ({
          role, content, ...(metadata.conversation_signal_turn ? { signalTurn: metadata.conversation_signal_turn } : {}),
        }))
      const answerCount = transcript.filter(entry => entry.role === "user").length
      if (!answerCount) return json({ error: "Send an answer before saving this preview." }, 400)
      const id = createHash("sha256").update(projectId).update(body.token).digest("hex")
      const { error } = await supabase.from(previewTable).upsert({
        id, project_id: projectId, status: preview.status, answer_count: answerCount,
        config: preview.config, reply_style: projectConversationReplyStyle(preview.config, {
          organisationId: orgId, projectId: preview.projectId,
        }) ?? null,
        transcript,
        signal_evidence: preview.transcript.at(-1)?.metadata?.conversation_signal_evidence ?? null,
        settings_conflict: preview.settingsConflict ?? null,
      }, { onConflict: "id", ignoreDuplicates: true })
      if (error) throw error
      return json({ id })
    }
    if (preview.status !== "active") return json({ error: "This preview is complete. Start a new preview." }, 409)
    const message = typeof body.message === "string" ? body.message.trim() : ""
    if (!message || message.length > 4000) return json({ error: "Enter a message of up to 4,000 characters." }, 400)
    const context = { organisationId: orgId, projectId: preview.projectId ?? "preview", apiKeyId: null, settings: normalizeProjectSettings(projectConversationSettings(preview.config)) }
    const response = await postConversation({
      configuration: projectConversationConfiguration(preview.config, context),
      context,
      sessionId: randomUUID(), message, previewTranscript: preview.transcript, runCompletion: false, reviewAuthoredSettings: true,
    })
    const result = await response.json()
    if (!response.ok) return json(result, response.status)
    const { previewTranscript, ...visible } = result
    const signalTurn = (previewTranscript as ConversationTranscriptEntry[]).at(-1)?.metadata.conversation_signal_turn
    return json({ ...visible, ...(signalTurn ? { signalTurn } : {}), token: signProjectPreview({
      ...preview, transcript: previewTranscript, status: result.status,
      settingsConflict: visible.settingsConflict ?? preview.settingsConflict,
    }) })
  } catch {
    return json({ error: "Preview is unavailable. Please retry." }, 503)
  }
}
