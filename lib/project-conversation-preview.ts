import { createHmac, timingSafeEqual } from "node:crypto"
import type { ConversationTranscriptEntry } from "@/lib/conversation-engine"
import { validateProjectConversation, type ProjectConversationConfig } from "@/lib/project-conversation-config"

export type ProjectConversationPreview = {
  organisationId: string
  projectId?: string
  actor: string
  expiresAt: number
  config: ProjectConversationConfig
  transcript: ConversationTranscriptEntry[]
  status: "active" | "completed"
}
function secret() {
  const key = process.env.GROUCHO_PREVIEW_SIGNING_KEY || process.env.SUPABASE_SERVICE_KEY
  if (!key) throw new Error("Preview signing is not configured")
  return key
}
function signature(payload: string) {
  return createHmac("sha256", secret()).update(`project-conversation-preview:v1:${payload}`).digest("base64url")
}
export function signProjectPreview(preview: ProjectConversationPreview) {
  const payload = Buffer.from(JSON.stringify(preview)).toString("base64url")
  return `${payload}.${signature(payload)}`
}
export function verifyProjectPreview(token: string, organisationId: string, actor: string): ProjectConversationPreview | null {
  if (token.length > 350_000) return null
  const [payload, sig, extra] = token.split(".")
  if (!payload || !sig || extra) return null
  const expected = Buffer.from(signature(payload))
  const supplied = Buffer.from(sig)
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString()) as ProjectConversationPreview
    if (value.organisationId !== organisationId || value.actor !== actor || !Number.isFinite(value.expiresAt) || value.expiresAt < Date.now() || !Array.isArray(value.transcript)) return null
    if (!validateProjectConversation(value.config).ok) return null
    return value
  } catch { return null }
}
