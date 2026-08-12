import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requireOrgMember, unauthorized } from "@/lib/org-access"
import { supabase } from "@/lib/supabase"

export async function GET(
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
  const deny = await requireOrgMember(actor, orgId)
  if (deny) return deny

  const { data: session, error: sErr } = await supabase
    .from("sessions")
    .select("id, project_id, organisation_id, persona_id, status")
    .eq("id", sessionId)
    .eq("project_id", projectId)
    .eq("organisation_id", orgId)
    .maybeSingle()

  if (sErr || !session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content, sent_at, metadata")
    .eq("session_id", sessionId)
    .order("sent_at", { ascending: true })

  if (error) {
    console.error("messages transcript:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  let profile: unknown = null
  let reviewerReport: unknown = null
  const concluded = ["passed", "failed", "redirected", "rejected"].includes(
    (session as { status?: string }).status ?? "",
  )
  if (concluded) {
    const { data: v } = await supabase
      .from("verdicts")
      .select("payload")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    const payload = (v?.payload as Record<string, unknown> | undefined) ?? null
    if (payload && payload.profile) profile = payload.profile
    if (payload && payload.reviewer_report) {
      reviewerReport = payload.reviewer_report
    }
  }

  let personaSchema: unknown = null
  const personaId = (session as { persona_id?: string | null }).persona_id
  if (personaId) {
    const { data: persona } = await supabase
      .from("personas")
      .select("profile_schema")
      .eq("id", personaId)
      .maybeSingle()
    personaSchema = persona?.profile_schema ?? null
  }

  return NextResponse.json({
    messages: data ?? [],
    profile,
    reviewerReport,
    personaSchema,
  })
}
