import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import { supabase } from "@/lib/supabase"
import { pendingOrganisationInvitation } from "@/lib/dashboard-access"
import { isSameOriginMutation } from "@/lib/platform-admin-access"

export async function POST(req: NextRequest) {
  if (!isSameOriginMutation(req)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 })
  let body: { token?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const token = typeof body?.token === "string" ? body.token.trim() : ""
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 })
  }

  const authClient = await createSupabaseServerClient()
  const {
    data: { user },
    error: userErr,
  } = await authClient.auth.getUser()

  if (userErr || !user?.email || !user.email_confirmed_at) {
    return NextResponse.json(
      { error: "Sign in with the invited email first (Supabase Auth)." },
      { status: 401 },
    )
  }

  const emailLower = user.email.trim().toLowerCase()

  const inv = await pendingOrganisationInvitation(token)
  if (!inv) return NextResponse.json({ error: "Invalid, expired or already used invitation." }, { status: 410 })

  if (inv.email.trim().toLowerCase() !== emailLower) {
    return NextResponse.json(
      {
        error:
          "Signed-in email does not match this invitation. Use the same email the invite was sent to.",
      },
      { status: 403 },
    )
  }

  const userId = user.id

  const { data: existing, error: membershipError } = await supabase
    .from("organisation_members")
    .select("id")
    .eq("organisation_id", inv.organisation_id)
    .eq("user_id", userId)
    .maybeSingle()

  if (membershipError) return NextResponse.json({ error: "Could not check organisation membership." }, { status: 503 })
  // Claim before granting access. Revocation, expiry or a concurrent acceptance must win.
  const acceptedAt = new Date().toISOString()
  const { data: claimed, error: claimError } = await supabase.from("invitations")
    .update({ accepted_at: acceptedAt }).eq("id", inv.id).eq("token", token)
    .eq("email", inv.email).eq("role", inv.role).eq("organisation_id", inv.organisation_id)
    .is("accepted_at", null).gt("expires_at", acceptedAt).select("id").maybeSingle()
  if (claimError) return NextResponse.json({ error: "Could not accept invitation." }, { status: 503 })
  if (!claimed) return NextResponse.json({ error: "Invitation is no longer available." }, { status: 410 })

  if (!existing) {
    const { error: insErr } = await supabase.from("organisation_members").insert({
      organisation_id: inv.organisation_id,
      user_id: userId,
      role: inv.role,
      accepted_at: new Date().toISOString(),
    })

    if (insErr) {
      // Restore only our own claim so a transient insert failure can be retried.
      await supabase.from("invitations").update({ accepted_at: null })
        .eq("id", inv.id).eq("accepted_at", acceptedAt)
      console.error("organisation_members insert:", insErr)
      return NextResponse.json({ error: "Could not join organisation" }, { status: 500 })
    }
  }

  return NextResponse.json({
    success: true,
    organisationId: inv.organisation_id,
    alreadyMember: Boolean(existing),
  })
}
