import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { supabase } from "@/lib/supabase"
import {
  ACCESS_FIELDS,
  accessStatus,
  isSameOriginMutation,
  issueAdminInvite,
  protectedAdmins,
} from "@/lib/platform-admin-access"
import { authRequestOrigin } from "@/lib/auth-redirect"
import { checkRateLimit } from "@/lib/rate-limit"

export async function GET() {
  const actor = await resolveAdminActor()
  if (!actor || actor.kind !== "platform")
    return NextResponse.json(
      { error: "Platform admin access required." },
      { status: actor ? 403 : 401 },
    )
  try {
    const protectedUsers = await protectedAdmins()
    const { data, error } = await supabase
      .from("platform_admin_access")
      .select(ACCESS_FIELDS)
      .order("invited_at", { ascending: false })
    if (error) throw error
    return NextResponse.json(
      {
        currentEmail: actor.email,
        users: [
          ...protectedUsers.filter(
            (user) =>
              user.protected ||
              !(data ?? []).some((row) => row.email === user.email),
          ),
          ...(data ?? [])
            .filter(
              (row) =>
                !protectedUsers.some(
                  (user) => user.protected && user.email === row.email,
                ),
            )
            .map((row) => ({
              ...row,
              status: accessStatus(row),
              protected: false,
              source: "Invitation",
            })),
        ],
      },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch {
    return NextResponse.json(
      { error: "Admin access could not be loaded. Please try again." },
      { status: 503 },
    )
  }
}
export async function POST(request: NextRequest) {
  const actor = await resolveAdminActor()
  if (!actor || actor.kind !== "platform")
    return NextResponse.json(
      { error: "Platform admin access required." },
      { status: actor ? 403 : 401 },
    )
  if (!isSameOriginMutation(request))
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 },
    )
  const body = await request.json().catch(() => null)
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : ""
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return NextResponse.json(
      { error: "Enter a valid email address." },
      { status: 400 },
    )
  if (
    !checkRateLimit({
      namespace: "admin-invite",
      key: actor.email,
      limit: 20,
      windowMs: 60_000,
    }).ok
  )
    return NextResponse.json(
      { error: "Too many invitations. Try again in a minute." },
      { status: 429 },
    )
  try {
    if (
      (await protectedAdmins()).some(
        (user) => user.protected && user.email === email,
      )
    )
      return NextResponse.json(
        { error: "This person already has protected admin access." },
        { status: 409 },
      )
    const legacy = (await protectedAdmins()).some(
      (user) => !user.protected && user.email === email,
    )
    if (legacy) {
      const { data, error } = await supabase
        .from("platform_admin_access")
        .select("id")
        .eq("email", email)
        .maybeSingle()
      if (error) throw error
      if (!data)
        return NextResponse.json(
          {
            error:
              "Remove this legacy operator’s access before inviting them to use an individual account.",
          },
          { status: 409 },
        )
    }
    const result = await issueAdminInvite(email, actor.email)
    if (result.conflict)
      return NextResponse.json(
        {
          error:
            "This person already has access, or their invitation just changed. Refresh the list.",
        },
        { status: 409 },
      )
    const origin = authRequestOrigin(request.url, request.headers.get("host"))
    return NextResponse.json(
      {
        invitation: result.invitation,
        inviteUrl: `${origin}/invite/admin/${result.token}`,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    )
  } catch {
    return NextResponse.json(
      { error: "The invitation could not be created. Try again." },
      { status: 503 },
    )
  }
}
