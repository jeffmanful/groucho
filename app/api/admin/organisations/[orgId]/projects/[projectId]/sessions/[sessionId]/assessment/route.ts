import { NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { assessColorsApplication } from "@/lib/admin-colors-assessment"
import { requireOrgAdmin, unauthorized } from "@/lib/org-access"
import { isSameOriginMutation } from "@/lib/platform-admin-access"

export const maxDuration = 300

export async function POST(req: Request, { params }: {
  params: Promise<{ orgId: string; projectId: string; sessionId: string }>
}) {
  if (!isSameOriginMutation(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, projectId, sessionId } = await params
  const deny = await requireOrgAdmin(actor, orgId)
  if (deny) return deny
  const result = await assessColorsApplication({
    organisationId: orgId, projectId, sessionId, requestId: req.headers.get("x-request-id") ?? undefined,
  })
  return NextResponse.json(result, { status: result.status === "failed" ? result.httpStatus : result.status === "pending" ? 202 : 200 })
}
