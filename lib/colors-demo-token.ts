import type { NextRequest } from "next/server"

export const DEMO_AUTH_COOKIE = "colors_demo_auth"
export const DEMO_SESSION_COOKIE = "colors_demo_session"
export const COLORS_DEMO_TESTER_EMAIL = "philipp@colorsxstudios.com"

type DemoToken = {
  kind: "tester" | "session"
  email: string
  sessionId?: string
  issuedAt: number
}

export function expectedTesterEmail(): string {
  return process.env.COLORS_DEMO_TESTER_EMAIL?.trim().toLowerCase() || COLORS_DEMO_TESTER_EMAIL
}

function encode(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function decode(value: string): string {
  return atob(value.replace(/-/g, "+").replace(/_/g, "/"))
}

async function hmacKey(): Promise<CryptoKey | null> {
  const secret = process.env.AUTH_SECRET?.trim()
  if (!secret) return null
  return crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  )
}

export async function issueDemoToken(payload: DemoToken): Promise<string | null> {
  const key = await hmacKey()
  if (!key) return null
  const body = encode(JSON.stringify(payload))
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))
  return `${body}.${encode(String.fromCharCode(...new Uint8Array(signature)))}`
}

export async function verifyDemoToken(raw: string | undefined, kind: DemoToken["kind"]): Promise<DemoToken | null> {
  if (!raw) return null
  const key = await hmacKey()
  if (!key) return null
  try {
    const [body, signature] = raw.split(".")
    if (!body || !signature) return null
    const valid = await crypto.subtle.verify(
      "HMAC", key,
      Uint8Array.from(decode(signature), (character) => character.charCodeAt(0)),
      new TextEncoder().encode(body),
    )
    if (!valid) return null
    const payload = JSON.parse(decode(body)) as DemoToken
    if (payload.kind !== kind || payload.email !== expectedTesterEmail()) return null
    if (!Number.isFinite(payload.issuedAt) || payload.issuedAt > Date.now() + 60_000) return null
    const lifetime = kind === "tester" ? 7 * 24 * 60 * 60_000 : 24 * 60 * 60_000
    if (Date.now() - payload.issuedAt > lifetime) return null
    if (kind === "session" && !payload.sessionId) return null
    return payload
  } catch {
    return null
  }
}

export async function demoTester(req: NextRequest): Promise<DemoToken | null> {
  return verifyDemoToken(req.cookies.get(DEMO_AUTH_COOKIE)?.value, "tester")
}

export async function demoSession(req: NextRequest, sessionId: string): Promise<DemoToken | null> {
  const tester = await demoTester(req)
  if (!tester) return null
  const session = await verifyDemoToken(req.cookies.get(DEMO_SESSION_COOKIE)?.value, "session")
  return session?.email === tester.email && session.sessionId === sessionId ? session : null
}

export function demoPasswordMatches(email: string, password: string): boolean {
  const configured = process.env.COLORS_DEMO_PASSWORD
  return Boolean(configured && email.trim().toLowerCase() === expectedTesterEmail() && password === configured)
}
