import { NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { buildNeedsYou } from "@/lib/needs-you"
import { requireOrgMember, unauthorized } from "@/lib/org-access"

export async function GET(_req: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId } = await params
  const deny = await requireOrgMember(actor, orgId)
  if (deny) return deny
  try {
    return NextResponse.json(await buildNeedsYou(orgId))
  } catch (error) {
    console.error("needs you:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
