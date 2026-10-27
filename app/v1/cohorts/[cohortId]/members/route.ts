import { NextRequest, NextResponse } from "next/server"
import { resolveApplicationsKey } from "@/lib/api-key-scopes"
import { fillCohort } from "@/lib/cohorts"
import { supabase } from "@/lib/supabase"

const MAX = 1000

/**
 * Place people in a cohort, for example the winners of a ballot you ran yourself.
 * Body: { sessionIds: string[] (your session keys), reason? }. People already in another cohort this round move here.
 * Only approved applications can be placed. Each move is sent as application.allocated.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ cohortId: string }> }) {
  const key = await resolveApplicationsKey(req.headers.get("authorization"))
  if (!key.ok) return NextResponse.json({ error: key.error }, { status: key.status })
  const { organisationId, projectId, apiKeyId } = key.context
  const { cohortId } = await params
  const body = (await req.json().catch(() => null)) as { sessionIds?: unknown; reason?: unknown } | null
  if (!Array.isArray(body?.sessionIds) || !body.sessionIds.length || body.sessionIds.length > MAX || !body.sessionIds.every((id) => typeof id === "string")) {
    return NextResponse.json({ error: `sessionIds must be a list of 1 to ${MAX} session ids` }, { status: 400 })
  }
  const keys = [...new Set((body.sessionIds as string[]).map((id) => id.trim()))]
  const { data: cohort, error: cohortError } = await supabase.from("cohorts").select("id").eq("id", cohortId).eq("project_id", projectId).maybeSingle()
  if (cohortError?.code === "22P02" || (!cohortError && !cohort)) return NextResponse.json({ error: "Cohort not found" }, { status: 404 })
  if (cohortError) return NextResponse.json({ error: "Database error" }, { status: 500 })

  const { data: rows, error } = await supabase.from("sessions").select("id, session_id").eq("project_id", projectId).in("session_id", keys)
  if (error) return NextResponse.json({ error: "Database error" }, { status: 500 })
  const found = new Map((rows ?? []).map((row) => [row.session_id as string, row.id as string]))
  const unknown = keys.filter((k) => !found.has(k))
  if (unknown.length) return NextResponse.json({ error: "Some session ids were not found", unknown }, { status: 404 })

  const result = await fillCohort({
    organisationId,
    projectId,
    source: "any",
    target: cohortId,
    mode: "select",
    sessionIds: [...found.values()],
    reason: typeof body.reason === "string" ? body.reason : null,
    actor: { kind: "api", apiKeyId },
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ runId: result.runId, moved: result.moved })
}
