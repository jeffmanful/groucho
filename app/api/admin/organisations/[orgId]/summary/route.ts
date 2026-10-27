import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requireOrgMember, unauthorized } from "@/lib/org-access"
import { buildOrganisationSummary } from "@/lib/organisation-summary"

/** One organisation's overview: projects, review workload, recent decisions and personas in use. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId } = await params
  const deny = await requireOrgMember(actor, orgId)
  if (deny) return deny
  try {
    const summary = await buildOrganisationSummary(actor, orgId, { detail: true })
    if (!summary) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(summary)
  } catch (error) {
    console.error("organisation summary:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
