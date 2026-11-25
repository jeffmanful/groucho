import { randomUUID } from "node:crypto"
import type { NextRequest } from "next/server"
import { isSameOriginMutation } from "@/lib/platform-admin-access"
import { checkRateLimit } from "@/lib/rate-limit"
import { DEMO_LINK_HEADER, demoJson, loadDemoLink } from "@/lib/project-demo-links"
import { openDemoRun, sealDemoRun } from "@/lib/project-demo-run"
import { replyToProjectPreview, startProjectPreview } from "@/lib/project-conversation-preview-runtime"
import { CONVERSATION_ENGINE_MARKER, postDemoConversation } from "@/lib/demo-conversation-profiles"
import { DEFAULT_INTERACTION_SPEC } from "@/lib/gatekeeper-interaction-spec"
import { normalizeProjectSettings } from "@/lib/project-settings"
import { colorsThinEventStream, wantsColorsThinStream } from "@/lib/colors-thin-stream"

export async function POST(req: NextRequest) {
  try {
    if (!isSameOriginMutation(req)) return demoJson({ error: "Invalid request origin." }, 403)
    const link = await loadDemoLink(req.headers.get(DEMO_LINK_HEADER) ?? "")
    if (!link || link.variant !== "conversation") {
      return demoJson({ error: "This demo link is unavailable. Ask the sender for a new link." }, 404)
    }
    if (!checkRateLimit({ namespace: "shared-project-demo", key: link.id, limit: 40, windowMs: 60_000 }).ok) {
      return demoJson({ error: "Please wait a minute before trying again." }, 429)
    }
    const raw = await req.text()
    if (raw.length > 400_000) return demoJson({ error: "This demo conversation is too long. Start again." }, 413)
    let body
    try { body = JSON.parse(raw) } catch { return demoJson({ error: "Invalid demo request." }, 400) }
    const { project, config, builtin } = link
    const settings = normalizeProjectSettings(project.settings)
    const personaId = settings.raw.persona_id
    if (body?.action === "start") {
      if (config) {
        const { preview, visible } = startProjectPreview(config, project.organisation_id, link.id, project.id)
        return demoJson({ message: visible.message, status: visible.status, ui: visible.ui, run: sealDemoRun(preview) })
      }
      if (!builtin || typeof personaId !== "string") return demoJson({ error: "Demo conversation unavailable." }, 404)
      const choice = builtin.openingChoice ? builtin.choices[builtin.openingChoice] : undefined
      const ui = { ...DEFAULT_INTERACTION_SPEC, ...(choice ? { inputType: choice.inputType ?? "singleSelect", options: [...choice.options] } : {}) }
      const run = sealDemoRun({
        actor: link.id, profileId: builtin.id, personaId, expiresAt: Date.now() + 60 * 60_000, status: "active",
        transcript: [{ role: "assistant", content: builtin.opening, metadata: {
          conversation_engine: CONVERSATION_ENGINE_MARKER, conversation_profile: builtin.id,
          ...(builtin.openingChoice ? { conversation_choice_key: builtin.openingChoice } : {}), ui,
        } }],
      })
      return demoJson({ message: builtin.opening, status: "active", ui, run })
    }
    const preview = body?.action === "message" && typeof body.run === "string" ? openDemoRun(body.run, link.id) : null
    if (!preview || preview.status !== "active") return demoJson({ error: "Start a new demo conversation to continue." }, 409)
    const message = typeof body.message === "string" ? body.message.trim() : ""
    if (!message || message.length > 4000) return demoJson({ error: "Enter a message of up to 4,000 characters." }, 400)
    if ("profileId" in preview && (preview.profileId !== builtin?.id || preview.personaId !== personaId)) {
      return demoJson({ error: "The project has changed. Start a new demo conversation." }, 409)
    }
    const turn = async (onReplyDelta?: (delta: string) => void) => {
      if ("config" in preview) {
        const result = await replyToProjectPreview(preview, message, { onReplyDelta })
        if (!result.ok) return demoJson({ error: "Groucho couldn’t reply. Try sending your message again." }, result.status)
        return demoJson({
          message: result.visible.message, status: result.visible.status, ui: result.visible.ui,
          run: sealDemoRun(result.preview),
        })
      }
      const response = await postDemoConversation({
        context: { organisationId: project.organisation_id, projectId: project.id, apiKeyId: null, settings },
        sessionId: randomUUID(), message, previewTranscript: preview.transcript, runCompletion: false, onReplyDelta,
      })
      if (!response.ok) return demoJson({ error: "Groucho couldn’t reply. Try sending your message again." }, response.status)
      const result = await response.json()
      return demoJson({
        message: result.message, status: result.status, ui: result.ui, completion: result.completion?.message,
        run: sealDemoRun({ ...preview, transcript: result.previewTranscript, status: result.status }),
      })
    }
    return wantsColorsThinStream(req.headers.get("accept")) ? colorsThinEventStream(turn) : await turn()
  } catch {
    return demoJson({ error: "Demo is unavailable. Please retry." }, 503)
  }
}
