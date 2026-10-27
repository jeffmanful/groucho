import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { buildDecisionLedger } from "@/lib/decision-ledger"
import { requireOrgMember, unauthorized } from "@/lib/org-access"

/** Decisions across the organisation's projects. Query: filter, q, project, limit, offset. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId } = await params
  const deny = await requireOrgMember(actor, orgId)
  if (deny) return deny
  try {
    return NextResponse.json(await buildDecisionLedger(orgId, new URL(req.url).searchParams))
  } catch (error) {
    console.error("decision ledger:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
