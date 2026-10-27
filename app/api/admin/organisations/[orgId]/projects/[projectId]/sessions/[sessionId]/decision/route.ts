import { NextRequest, NextResponse } from "next/server"
import { parseHumanApplicationDecision } from "@/lib/application-decision"
import { recordHumanApplicationDecision } from "@/lib/application-decision-record"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requireOrgAdmin, unauthorized } from "@/lib/org-access"

/** Approve or decline a finished application from the dashboard. */
export async function POST(
  req: NextRequest,
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

  let body: { decision?: unknown; reason?: unknown; applicantReason?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const decision = parseHumanApplicationDecision(body.decision)
  if (!decision) {
    return NextResponse.json(
      { error: "decision must be approved or declined" },
      { status: 400 },
    )
  }

  const result = await recordHumanApplicationDecision({
    organisationId: orgId,
    projectId,
    sessionId,
    decision,
    reason: typeof body.reason === "string" ? body.reason : "",
    applicantReason: typeof body.applicantReason === "string" ? body.applicantReason : null,
    reviewer:
      actor.kind === "platform"
        ? { kind: "platform", email: actor.email }
        : { kind: "member", userId: actor.userId, email: actor.email },
  })
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.existing ? { decision: result.existing } : {}) },
      { status: result.status },
    )
  }

  return NextResponse.json({
    decision: result.decision,
    reviewStatus: decision,
    ...(result.accessSecret ? { accessSecret: result.accessSecret } : {}),
  })
}
