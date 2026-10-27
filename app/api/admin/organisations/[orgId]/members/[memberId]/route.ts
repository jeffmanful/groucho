import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { memberChangeError, type MemberChange } from "@/lib/member-management"
import { fetchOrgRole, unauthorized, type OrgRole } from "@/lib/org-access"
import { supabase } from "@/lib/supabase"

type Params = { params: Promise<{ orgId: string; memberId: string }> }

async function check(req: NextRequest | null, params: Params["params"], change: MemberChange | null) {
  const actor = await resolveAdminActor()
  if (!actor) return { response: unauthorized() }
  const { orgId, memberId } = await params

  const { data: target, error } = await supabase
    .from("organisation_members")
    .select("id, user_id, role")
    .eq("id", memberId)
    .eq("organisation_id", orgId)
    .maybeSingle()
  if (error) return { response: NextResponse.json({ error: "Database error" }, { status: 500 }) }

  const actorRole = actor.kind === "platform" ? null : await fetchOrgRole(actor.userId, orgId)
  // Someone outside the organisation learns nothing about its members.
  if (actor.kind !== "platform" && !actorRole) return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  if (!target) return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) }

  let resolved = change
  if (!resolved && req) {
    const body = await req.json().catch(() => null)
    const role = typeof body?.role === "string" ? body.role.trim().toLowerCase() : ""
    resolved = { kind: "role", role: role as OrgRole }
  }

  const { count, error: countError } = await supabase
    .from("organisation_members")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", orgId)
    .eq("role", "owner")
  if (countError) return { response: NextResponse.json({ error: "Database error" }, { status: 500 }) }

  const refusal = memberChangeError({
    actorIsPlatform: actor.kind === "platform",
    actorRole,
    actorUserId: actor.kind === "platform" ? null : actor.userId,
    target: { user_id: target.user_id as string, role: target.role as OrgRole },
    ownerCount: count ?? 0,
    change: resolved!,
  })
  if (refusal) return { response: NextResponse.json({ error: refusal.error }, { status: refusal.status }) }
  return { orgId, memberId, change: resolved! }
}

/** Change a member's role. Body: { role: "member" | "admin" | "owner" }. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const result = await check(req, params, null)
  if ("response" in result) return result.response
  if (result.change.kind !== "role") return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  const { data, error } = await supabase
    .from("organisation_members")
    .update({ role: result.change.role })
    .eq("id", result.memberId)
    .eq("organisation_id", result.orgId)
    .select("id, user_id, role, invited_at, accepted_at")
    .single()
  if (error) {
    console.error("member role update:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
  return NextResponse.json(data)
}

/** Remove someone from the organisation. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const result = await check(null, params, { kind: "remove" })
  if ("response" in result) return result.response
  const { error } = await supabase
    .from("organisation_members")
    .delete()
    .eq("id", result.memberId)
    .eq("organisation_id", result.orgId)
  if (error) {
    console.error("member remove:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
