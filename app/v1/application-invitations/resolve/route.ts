import { NextResponse } from "next/server"
import { resolveProjectContext } from "@/lib/project-resolution"
import { resolveApplicationInvitation } from "@/lib/application-invitations"
import { checkRateLimit } from "@/lib/rate-limit"

/** Server-to-server invitation check. The Forum's conversations key fixes the project. */
export async function POST(req: Request) {
  const resolved = await resolveProjectContext(req.headers.get("authorization"))
  if (!resolved.ok) return NextResponse.json(resolved.body, { status: resolved.status })
  if (!resolved.context.apiKeyId) return NextResponse.json({ error: "Authorization required" }, { status: 401 })
  const limit = checkRateLimit({ namespace: "application-invitation-resolve", key: resolved.context.apiKeyId, limit: 120, windowMs: 60_000 })
  if (!limit.ok) return NextResponse.json({ error: "Please retry shortly" }, { status: 429 })
  const body = await req.json().catch(() => null)
  try {
    const invitation = await resolveApplicationInvitation(resolved.context.projectId, body?.token)
    return invitation
      ? NextResponse.json(invitation, { headers: { "Cache-Control": "private, no-store" } })
      : NextResponse.json({ error: "This application invitation is invalid, expired or revoked." }, { status: 403 })
  } catch { return NextResponse.json({ error: "Invitation service unavailable. Please retry." }, { status: 503 }) }
}
