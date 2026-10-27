import { NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { retryDelivery } from "@/lib/needs-you"
import { requireOrgAdmin, unauthorized } from "@/lib/org-access"

/** Send a failed webhook delivery once more, now. */
export async function POST(_req: Request, { params }: { params: Promise<{ orgId: string; deliveryId: string }> }) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, deliveryId } = await params
  const deny = await requireOrgAdmin(actor, orgId)
  if (deny) return deny
  const result = await retryDelivery(orgId, deliveryId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result)
}
