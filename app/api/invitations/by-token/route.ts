import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { validOrganisationInviteToken } from "@/lib/dashboard-access"

/**
 * Public metadata for a valid invite token.
 * Rate limiting should be added at the edge in production.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim()
  if (!validOrganisationInviteToken(token)) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 })
  }

  const { data: inv, error } = await supabase
    .from("invitations")
    .select(
      "id, email, role, expires_at, accepted_at, organisations(name, slug)",
    )
    .eq("token", token)
    .maybeSingle()

  if (error || !inv) {
    return NextResponse.json({ error: "Invalid or expired invitation" }, { status: 404 })
  }

  if (inv.accepted_at) {
    return NextResponse.json({ error: "Invitation already used" }, { status: 410 })
  }

  const expires = new Date(inv.expires_at)
  if (expires.getTime() < Date.now()) {
    return NextResponse.json({ error: "Invitation expired" }, { status: 410 })
  }

  const rawOrg = inv.organisations as unknown
  const org = Array.isArray(rawOrg)
    ? (rawOrg[0] as { name: string; slug: string } | undefined)
    : (rawOrg as { name: string; slug: string } | null)

  return NextResponse.json({
    organisationName: org?.name ?? "Organisation",
    organisationSlug: org?.slug ?? "",
    email: inv.email,
    role: inv.role,
    expiresAt: inv.expires_at,
  }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } })
}
