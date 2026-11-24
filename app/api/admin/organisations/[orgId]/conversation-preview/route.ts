import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requireOrgAdmin, unauthorized } from "@/lib/org-access"
import { isSameOriginMutation } from "@/lib/platform-admin-access"
import { checkRateLimit } from "@/lib/rate-limit"
import { postConversation, type ConversationTranscriptEntry } from "@/lib/conversation-engine"
import { validateProjectConversation, projectConversationOpening, projectConversationSettings } from "@/lib/project-conversation-config"
import { projectConversationConfiguration, projectConversationProfile } from "@/lib/project-conversation-runtime"
import { signProjectPreview, verifyProjectPreview } from "@/lib/project-conversation-preview"
import { normalizeProjectSettings } from "@/lib/project-settings"
import { emptySignalEvidence } from "@/lib/project-conversation-evidence"
import { DEFAULT_INTERACTION_SPEC } from "@/lib/gatekeeper-interaction-spec"

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } })
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
      const runtime = projectConversationConfiguration(config)
      const message = projectConversationOpening(config)
      const profile = projectConversationProfile(config)
      const choice = profile.openingChoice ? profile.choices[profile.openingChoice] : undefined
      const ui = { ...DEFAULT_INTERACTION_SPEC, ...(choice ? { inputType: choice.inputType ?? "singleSelect", options: [...choice.options] } : {}) }
      const transcript: ConversationTranscriptEntry[] = [{ role: "assistant", content: message, metadata: {
        conversation_engine: runtime.marker, conversation_profile: runtime.id, ...(profile.openingChoice ? { conversation_choice_key: profile.openingChoice } : {}), ui,
      } }]
      return json({ message, status: "active", ui, ...(config.version === 2 ? { signalEvidence: emptySignalEvidence(config.signals) } : {}), token: signProjectPreview({
        organisationId: orgId, actor: actorId, expiresAt: Date.now() + 60 * 60_000, config, transcript, status: "active",
      }) })
    }
    if (body.action !== "message" || typeof body.token !== "string") return json({ error: "Start a preview first." }, 400)
    const preview = verifyProjectPreview(body.token, orgId, actorId)
    if (!preview) return json({ error: "Preview expired or changed. Start a new preview." }, 409)
    if (preview.status !== "active") return json({ error: "This preview is complete. Start a new preview." }, 409)
    const message = typeof body.message === "string" ? body.message.trim() : ""
    if (!message || message.length > 4000) return json({ error: "Enter a message of up to 4,000 characters." }, 400)
    const response = await postConversation({
      configuration: projectConversationConfiguration(preview.config),
      context: { organisationId: orgId, projectId: "preview", apiKeyId: null, settings: normalizeProjectSettings(projectConversationSettings(preview.config)) },
      sessionId: randomUUID(), message, previewTranscript: preview.transcript, runCompletion: false, reviewAuthoredSettings: true,
    })
    const result = await response.json()
    if (!response.ok) return json(result, response.status)
    const { previewTranscript, ...visible } = result
    return json({ ...visible, token: signProjectPreview({ ...preview, transcript: previewTranscript, status: result.status }) })
  } catch {
    return json({ error: "Preview is unavailable. Please retry." }, 503)
  }
}
