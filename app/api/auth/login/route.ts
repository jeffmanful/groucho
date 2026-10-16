import { legacyPlatformEnabled } from "@/lib/platform-admin-access"
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase-server"
import { checkRateLimit } from "@/lib/rate-limit"
import { NextRequest, NextResponse } from "next/server"
import {
  DEMO_AUTH_COOKIE,
  demoPasswordMatches,
  isDemoTesterEmail,
  issueDemoToken,
} from "@/lib/colors-demo-token"

async function signToken(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  )
  const toBase64Url = (buf: ArrayBuffer) =>
    btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")

  return `${payload}.${toBase64Url(sig)}`
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const email = body?.email
  const password = body?.password

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !email.trim() ||
    !password ||
    email.length > 320 ||
    password.length > 1024
  ) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 })
  }

  const allowed = (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())

  const emailLower = email.trim().toLowerCase()

  const limit = checkRateLimit({
    namespace: "login",
    key: emailLower,
    limit: 10,
    windowMs: 60_000,
  })
  if (!limit.ok)
    return NextResponse.json(
      { error: "Too many attempts. Please try again shortly." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)),
        },
      },
    )

  if (demoPasswordMatches(emailLower, password)) {
    const token = await issueDemoToken({
      kind: "tester",
      email: emailLower,
      issuedAt: Date.now(),
    })
    if (!token)
      return NextResponse.json(
        { error: "Server misconfigured" },
        { status: 500 },
      )
    const res = NextResponse.json({ ok: true, role: "colors_demo_tester" })
    res.cookies.set(DEMO_AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
      secure: process.env.NODE_ENV === "production",
    })
    return res
  }

  if (isDemoTesterEmail(emailLower)) {
    return NextResponse.json({ error: "Access denied" }, { status: 401 })
  }

  if (isSupabaseServerConfigured()) {
    const client = await createSupabaseServerClient()
    const { data, error } = await client.auth.signInWithPassword({
      email: emailLower,
      password,
    })
    if (!error && data.user) {
      const response = NextResponse.json({ ok: true })
      response.cookies.delete("pe_auth")
      response.cookies.delete(DEMO_AUTH_COOKIE)
      return response
    }
  }

  if (
    !allowed.includes(emailLower) ||
    password !== process.env.ADMIN_PASSWORD ||
    !(await legacyPlatformEnabled(emailLower))
  ) {
    return NextResponse.json({ error: "Access denied" }, { status: 401 })
  }

  const secret = process.env.AUTH_SECRET
  if (!secret) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }

  const payloadB64 = btoa(`${emailLower}|${Date.now()}`)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

  const token = await signToken(payloadB64, secret)

  const res = NextResponse.json({ ok: true })
  res.cookies.set("pe_auth", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    secure: process.env.NODE_ENV === "production",
  })
  return res
}
