import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requireOrgMember, unauthorized } from "@/lib/org-access"
import { supabase } from "@/lib/supabase"

const PAGE_SIZE = 50

export async function GET(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ orgId: string; projectId: string }> },
) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, projectId } = await params
  const deny = await requireOrgMember(actor, orgId)
  if (deny) return deny

  const { searchParams } = new URL(req.url)
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0)

  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("organisation_id", orgId)
    .maybeSingle()

  if (pErr || !project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const { data, error, count } = await supabase
    .from("sessions")
    .select(
      "id, session_id, status, persona_id, created_at, updated_at, profile_extracted_at, applicant_email, applicant_name",
      { count: "exact" },
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (error) {
    console.error("sessions list:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  return NextResponse.json({
    sessions: data ?? [],
    total: count ?? 0,
    offset,
    limit: PAGE_SIZE,
  })
}
