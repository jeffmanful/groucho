import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto"
import type { ConversationTranscriptEntry } from "@/lib/conversation-engine"
import type { ProjectConversationPreview } from "@/lib/project-conversation-preview"

type DemoRun = ProjectConversationPreview | {
  profileId: string
  personaId: string
  actor: string
  expiresAt: number
  transcript: ConversationTranscriptEntry[]
  status: "active" | "completed"
}

function runKey(linkId: string) {
  const secret = process.env.GROUCHO_PREVIEW_SIGNING_KEY || process.env.SUPABASE_SERVICE_KEY
  if (!secret) throw new Error("Demo signing is not configured")
  return createHmac("sha256", secret).update(`project-demo:conversation:v1:${linkId}`).digest()
}

export function sealDemoRun(preview: DemoRun) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", runKey(preview.actor), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(preview), "utf8"), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url")
}

export function openDemoRun(token: string, linkId: string) {
  if (token.length > 350_000) return null
  try {
    const bytes = Buffer.from(token, "base64url")
    const decipher = createDecipheriv("aes-256-gcm", runKey(linkId), bytes.subarray(0, 12))
    decipher.setAuthTag(bytes.subarray(12, 28))
    const decoded = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()])
    const preview = JSON.parse(decoded.toString("utf8")) as DemoRun
    return preview.expiresAt > Date.now() ? preview : null
  } catch {
    return null
  }
}
