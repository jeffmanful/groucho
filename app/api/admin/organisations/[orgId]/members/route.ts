import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requireOrgMember, unauthorized } from "@/lib/org-access"
import { supabase } from "@/lib/supabase"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId } = await params
  const deny = await requireOrgMember(actor, orgId)
  if (deny) return deny

  const { data: org, error: oErr } = await supabase
    .from("organisations")
    .select("id")
    .eq("id", orgId)
    .maybeSingle()

  if (oErr || !org) {
    return NextResponse.json({ error: "Organisation not found" }, { status: 404 })
  }

  const { data: rows, error } = await supabase
    .from("organisation_members")
    .select("id, user_id, role, invited_at, accepted_at")
    .eq("organisation_id", orgId)
    .order("accepted_at", { ascending: false, nullsFirst: false })

  if (error) {
    console.error("organisation_members list:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  const members = rows ?? []
  const enriched = await Promise.all(
    members.map(async (m) => {
      let email: string | null = null
      try {
        const { data: u, error: uErr } = await supabase.auth.admin.getUserById(m.user_id)
        if (!uErr && u.user?.email) email = u.user.email
      } catch {
        /* ignore */
      }
      return { ...m, email, is_you: actor.kind === "member" && actor.userId === m.user_id }
    }),
  )

  return NextResponse.json(enriched)
}
