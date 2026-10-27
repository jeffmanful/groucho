import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requireOrgAdmin, unauthorized } from "@/lib/org-access"
import { acceptSourceUpdate, PersonaOwnershipError } from "@/lib/persona-ownership"
import { invalidatePersonaCache } from "@/lib/persona-resolution"

/** Bring a clone up to its Groucho original's current version. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ orgId: string; personaId: string }> }) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, personaId } = await params
  const deny = await requireOrgAdmin(actor, orgId)
  if (deny) return deny

  let body: { expectedVersion?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
  if (typeof body.expectedVersion !== "number" || !Number.isInteger(body.expectedVersion)) {
    return NextResponse.json({ error: "expectedVersion is required" }, { status: 400 })
  }

  try {
    const persona = await acceptSourceUpdate({ personaId, organisationId: orgId, expectedVersion: body.expectedVersion })
    invalidatePersonaCache(personaId)
    return NextResponse.json(persona)
  } catch (error) {
    if (error instanceof PersonaOwnershipError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("accept persona update:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
