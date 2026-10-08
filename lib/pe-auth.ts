/** Verify `pe_auth` cookie (HMAC payload). Returns email or null. */
export async function verifyPeAuthEmail(
  token: string,
  secret: string,
): Promise<string | null> {
  try {
    const [payloadB64, sigB64] = token.split(".")
    if (!payloadB64 || !sigB64) return null

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    )

    const sigBytes = Uint8Array.from(
      atob(sigB64.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    )
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      new TextEncoder().encode(payloadB64),
    )
    if (!valid) return null

    const payload = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"))
    const [email] = payload.split("|")
    return email || null
  } catch {
    return null
  }
}

export function isAllowedPlatformEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase()
  if (isDemoTesterEmail(normalized)) return false
  const allowed = (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
  return allowed.includes(normalized)
}
import { isDemoTesterEmail } from "@/lib/colors-demo-token"
