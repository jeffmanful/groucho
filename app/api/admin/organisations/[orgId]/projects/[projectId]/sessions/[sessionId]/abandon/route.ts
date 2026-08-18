import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requireOrgAdmin, unauthorized } from "@/lib/org-access"
import { supabase } from "@/lib/supabase"

export async function POST(
  _req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ orgId: string; projectId: string; sessionId: string }>
  },
) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()

  const { orgId, projectId, sessionId } = await params
  const deny = await requireOrgAdmin(actor, orgId)
  if (deny) return deny

  const { data: session, error: readError } = await supabase
    .from("sessions")
    .select("id, status")
    .eq("id", sessionId)
    .eq("project_id", projectId)
    .eq("organisation_id", orgId)
    .maybeSingle()

  if (readError || !session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  if (session.status !== "active") {
    return NextResponse.json(
      { error: `Session is already ${session.status}` },
      { status: 409 },
    )
  }

  const { data: updated, error: updateError } = await supabase
    .from("sessions")
    .update({ status: "abandoned" })
    .eq("id", sessionId)
    .eq("project_id", projectId)
    .eq("organisation_id", orgId)
    .eq("status", "active")
    .select("id, status, updated_at")
    .maybeSingle()

  if (updateError) {
    console.error("session abandon:", updateError)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
  if (!updated) {
    return NextResponse.json(
      { error: "Session status changed before it could be abandoned" },
      { status: 409 },
    )
  }

  return NextResponse.json({ session: updated })
}
