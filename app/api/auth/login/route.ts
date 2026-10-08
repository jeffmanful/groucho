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
    ["sign"]
  )
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
  const toBase64Url = (buf: ArrayBuffer) =>
    btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")

  return `${payload}.${toBase64Url(sig)}`
}

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()

  if (!email || !password) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 })
  }

  const allowed = (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())

  const emailLower = email.trim().toLowerCase()

  if (demoPasswordMatches(emailLower, password)) {
    const token = await issueDemoToken({
      kind: "tester",
      email: emailLower,
      issuedAt: Date.now(),
    })
    if (!token) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
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

  if (!allowed.includes(emailLower) || password !== process.env.ADMIN_PASSWORD) {
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
