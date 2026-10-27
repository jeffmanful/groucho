import { NextRequest, NextResponse } from "next/server"
import { readApplicantSignals, scheduleApplicantSignals } from "@/lib/applicant-signals"
import { createEntry, parseEntryInput } from "@/lib/entries"
import { resolveProjectContext } from "@/lib/project-resolution"

/**
 * Submit a drop entry without a conversation. Body: { sessionId, applicant: { email, name? }, phone?, socials?, fields? }.
 * Sending the same sessionId again returns the first entry (200) instead of creating another.
 */
export async function POST(req: NextRequest) {
  const resolved = await resolveProjectContext(req.headers.get("authorization"))
  if (!resolved.ok) return NextResponse.json(resolved.body, { status: resolved.status })
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : ""
  if (sessionId.length < 8 || sessionId.length > 128) return NextResponse.json({ error: "sessionId must be 8 to 128 characters" }, { status: 400 })
  const parsed = parseEntryInput(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const result = await createEntry({
    organisationId: resolved.context.organisationId,
    projectId: resolved.context.projectId,
    clientSessionKey: sessionId,
    entry: parsed.value,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  if (result.created) {
    scheduleApplicantSignals({ sessionRowId: result.id }, readApplicantSignals(req.headers, { viaApiKey: Boolean(resolved.context.apiKeyId) }))
  }
  return NextResponse.json({ sessionId, status: "received", duplicate: !result.created }, { status: result.created ? 201 : 200 })
}
