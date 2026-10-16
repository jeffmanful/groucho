import { authRequestOrigin } from "@/lib/auth-redirect"
import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import {
  inviteHash,
  validInviteToken,
  verifiedInviteEmail,
  isSameOriginMutation,
} from "@/lib/platform-admin-access"
import { checkRateLimit } from "@/lib/rate-limit"

const unavailable = () =>
  NextResponse.json(
    {
      error:
        "This invitation has expired, been cancelled, or already been used. Ask an administrator for a new one.",
    },
    { status: 410 },
  )
async function pending(token: string) {
  const { data, error } = await supabase
    .from("platform_admin_access")
    .select("id,email,expires_at")
    .eq("token_hash", inviteHash(token))
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle()
  if (error) throw error
  return data
}
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  if (!validInviteToken(token)) return unavailable()
  try {
    const invitation = await pending(token)
    if (!invitation) return unavailable()
    return NextResponse.json(invitation, {
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    })
  } catch {
    return NextResponse.json(
      { error: "Invitation could not be loaded. Please try again." },
      { status: 503 },
    )
  }
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!isSameOriginMutation(request))
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 },
    )
  const { token } = await params
  if (!validInviteToken(token)) return unavailable()
  if (
    !checkRateLimit({
      namespace: "accept-admin-invite",
      key: inviteHash(token),
      limit: 15,
      windowMs: 60_000,
    }).ok
  )
    return NextResponse.json(
      { error: "Too many attempts. Try again in a minute." },
      { status: 429 },
    )
  try {
    const invitation = await pending(token)
    if (!invitation) return unavailable()
    const client = await createSupabaseServerClient()
    const body = await request.json().catch(() => ({}))
    if (body?.action === "email") {
      const callback = new URL(
        "/api/auth/callback",
        authRequestOrigin(request.url, request.headers.get("host")),
      )
      callback.searchParams.set("next", `/invite/admin/${token}`)
      const { error } = await client.auth.signInWithOtp({
        email: invitation.email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: callback.toString(),
        },
      })
      if (error)
        return NextResponse.json(
          {
            error:
              "Email sign-in could not be sent. Please try again shortly or use Google.",
          },
          { status: 429 },
        )
      return NextResponse.json({ ok: true })
    }
    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser()
    if (userError || !user)
      return NextResponse.json(
        { error: "Sign in with the invited email before accepting." },
        { status: 401 },
      )
    if (!verifiedInviteEmail(user, invitation.email))
      return NextResponse.json(
        { error: `Sign in as ${invitation.email} to accept this invitation.` },
        { status: 403 },
      )
    const { data, error } = await supabase
      .from("platform_admin_access")
      .update({
        status: "active",
        user_id: user.id,
        accepted_at: new Date().toISOString(),
        token_hash: null,
      })
      .eq("id", invitation.id)
      .eq("token_hash", inviteHash(token))
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .select("id")
      .maybeSingle()
    if (error) throw error
    if (!data) return unavailable()
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json(
      { error: "The invitation could not be accepted. Try again." },
      { status: 503 },
    )
  }
}
