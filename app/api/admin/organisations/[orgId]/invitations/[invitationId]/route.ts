import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requireOrgAdmin, requireOrgOwner, unauthorized } from "@/lib/org-access"
import { isSameOriginMutation } from "@/lib/platform-admin-access"
import { checkRateLimit } from "@/lib/rate-limit"
import { supabase } from "@/lib/supabase"

type RouteContext = { params: Promise<{ orgId: string; invitationId: string }> }

async function loadPendingInvitation({ params }: RouteContext) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, invitationId } = await params
  const deny = await requireOrgAdmin(actor, orgId)
  if (deny) return deny

  const { data, error } = await supabase
    .from("invitations")
    .select("email, role, token")
    .eq("id", invitationId)
    .eq("organisation_id", orgId)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle()

  if (error) {
    console.error("invitation link lookup:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
  if (!data?.token) {
    return NextResponse.json({ error: "This invitation is no longer pending." }, { status: 404 })
  }
  if (data.role === "owner") {
    const denyOwner = await requireOrgOwner(actor, orgId)
    if (denyOwner) return denyOwner
  }

  return { orgId, invitationId, email: data.email, token: data.token }
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const invitation = await loadPendingInvitation(context)
  if (invitation instanceof NextResponse) return invitation
  return NextResponse.json(
    { email: invitation.email, token: invitation.token },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}

export async function POST(req: NextRequest, context: RouteContext) {
  if (!isSameOriginMutation(req)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 })
  }
  const invitation = await loadPendingInvitation(context)
  if (invitation instanceof NextResponse) return invitation

  const requestId = req.headers.get("Idempotency-Key")
  if (!requestId || !/^[a-f0-9-]{36}$/.test(requestId)) {
    return NextResponse.json({ error: "Invalid email request." }, { status: 400 })
  }

  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.GROUCHO_INVITATION_FROM_EMAIL?.trim()
  const baseUrl = process.env.GROUCHO_INVITATION_BASE_URL ?? ""
  const appUrl = URL.canParse(baseUrl) ? new URL(baseUrl) : null
  if (!apiKey || !from || appUrl?.protocol !== "https:") {
    return NextResponse.json(
      { error: "Invitation email is unavailable. You can copy and share the link instead." },
      { status: 503 },
    )
  }
  if (!checkRateLimit({ namespace: "organisation-invitation-send", key: invitation.invitationId, limit: 3, windowMs: 60_000 }).ok) {
    return NextResponse.json({ error: "Too many send attempts. Try again in a minute." }, { status: 429 })
  }

  const { data: organisation, error } = await supabase
    .from("organisations")
    .select("name")
    .eq("id", invitation.orgId)
    .maybeSingle()
  if (error || !organisation) {
    return NextResponse.json({ error: "The organisation could not be loaded." }, { status: 500 })
  }

  const link = new URL(`/invite/${invitation.token}`, appUrl.origin)
  const failure = "We couldn’t confirm the invitation email was sent. Try again or copy the link."
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `organisation-invite/${invitation.invitationId}/${requestId}`,
      },
      body: JSON.stringify({
        from,
        to: [invitation.email],
        subject: "You’re invited to Groucho",
        text: `You’ve been invited to join ${organisation.name} on Groucho.\n\nOpen your invitation to get started:\n${link}\n\nUse this email address to sign in. You can request a sign-in code on the invitation page.\n\nIf you weren’t expecting this invitation, you can ignore this email.`,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      console.error("invitation email provider status:", response.status)
      return NextResponse.json({ error: failure }, { status: 502 })
    }
  } catch {
    return NextResponse.json({ error: failure }, { status: 502 })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(
  _req: NextRequest,
  {
    params,
  }: { params: Promise<{ orgId: string; invitationId: string }> },
) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, invitationId } = await params
  const deny = await requireOrgAdmin(actor, orgId)
  if (deny) return deny

  const { data: row, error: findErr } = await supabase
    .from("invitations")
    .select("id, accepted_at")
    .eq("id", invitationId)
    .eq("organisation_id", orgId)
    .maybeSingle()

  if (findErr || !row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  if (row.accepted_at) {
    return NextResponse.json(
      { error: "Cannot delete an invitation that was already accepted." },
      { status: 400 },
    )
  }

  const { error } = await supabase
    .from("invitations")
    .delete()
    .eq("id", invitationId)
    .eq("organisation_id", orgId)

  if (error) {
    console.error("invitations delete:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
