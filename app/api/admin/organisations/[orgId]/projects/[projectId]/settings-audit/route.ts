import { NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requireOrgAdmin, unauthorized } from "@/lib/org-access"
import { supabase } from "@/lib/supabase"

export async function GET(
  _req: Request,
  {
    params,
  }: { params: Promise<{ orgId: string; projectId: string }> },
) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, projectId } = await params
  const deny = await requireOrgAdmin(actor, orgId)
  if (deny) return deny

  const { data, error } = await supabase
    .from("project_settings_audit")
    .select("id, actor_kind, actor_email, source, changed_keys, created_at")
    .eq("organisation_id", orgId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(10)

  if (error) {
    console.error("project settings audit list:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  return NextResponse.json({ changes: data ?? [] })
}
