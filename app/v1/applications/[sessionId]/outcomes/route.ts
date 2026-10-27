import { NextRequest, NextResponse } from "next/server"
import { resolveApplicationsKey } from "@/lib/api-key-scopes"
import { APPLICATION_OUTCOMES, parseApplicationOutcome, parseOccurredAt, recordApplicationOutcome } from "@/lib/application-outcomes"
import { supabase } from "@/lib/supabase"

/**
 * Report what happened after a decision: { outcome, occurredAt?, note? }.
 * outcome: invited, joined, invite_declined, no_response, active, inactive, left or removed.
 * Reporting the same outcome with the same occurredAt again is ignored (200).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const key = await resolveApplicationsKey(req.headers.get("authorization"))
  if (!key.ok) return NextResponse.json({ error: key.error }, { status: key.status })
  const { organisationId, projectId, apiKeyId } = key.context
  const clientKey = decodeURIComponent((await params).sessionId).trim()

  const body = (await req.json().catch(() => null)) as { outcome?: unknown; occurredAt?: unknown; note?: unknown } | null
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  const outcome = parseApplicationOutcome(body.outcome)
  if (!outcome) {
    return NextResponse.json({ error: `outcome must be one of: ${APPLICATION_OUTCOMES.join(", ")}` }, { status: 400 })
  }
  const occurredAt = parseOccurredAt(body.occurredAt)
  if (!occurredAt) return NextResponse.json({ error: "occurredAt must be an ISO date-time, not in the future" }, { status: 400 })

  const { data: session, error } = await supabase
    .from("sessions")
    .select("id")
    .eq("project_id", projectId)
    .eq("session_id", clientKey)
    .maybeSingle()
  if (error) return NextResponse.json({ error: "Database error" }, { status: 500 })
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const result = await recordApplicationOutcome({
    organisationId,
    projectId,
    sessionId: session.id as string,
    outcome,
    occurredAt,
    note: typeof body.note === "string" ? body.note : null,
    apiKeyId,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(
    {
      sessionId: clientKey,
      outcome,
      occurredAt,
      duplicate: result.duplicate,
      ...(result.outcome ? { id: result.outcome.id, reportedAt: result.outcome.reported_at } : {}),
    },
    { status: result.duplicate ? 200 : 201 },
  )
}
