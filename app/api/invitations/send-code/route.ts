import { NextRequest, NextResponse } from "next/server"
import { pendingOrganisationInvitation } from "@/lib/dashboard-access"
import { authRequestOrigin } from "@/lib/auth-redirect"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import { isSameOriginMutation } from "@/lib/platform-admin-access"
import { checkRateLimit } from "@/lib/rate-limit"

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 })
  const body = await request.json().catch(() => null)
  const invitation = await pendingOrganisationInvitation(body?.token)
  if (!invitation) return NextResponse.json({ error: "Invalid, expired or already used invitation." }, { status: 410 })
  if (!checkRateLimit({ namespace: "organisation-invite-email", key: invitation.id, limit: 5, windowMs: 60_000 }).ok) {
    return NextResponse.json({ error: "Too many attempts. Please try again shortly." }, { status: 429 })
  }
  const callback = new URL("/api/auth/callback", authRequestOrigin(request.url, request.headers.get("host")))
  callback.searchParams.set("next", `/invite/${body.token}`)
  const client = await createSupabaseServerClient()
  const { error } = await client.auth.signInWithOtp({ email: invitation.email, options: {
    shouldCreateUser: true, emailRedirectTo: callback.toString(),
  } })
  return error
    ? NextResponse.json({ error: "Email sign-in could not be sent. Please try again shortly." }, { status: 429 })
    : NextResponse.json({ ok: true })
}
