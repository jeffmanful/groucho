import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { fetchOrgRole, requireOrgAdmin, requireOrgMember, unauthorized } from "@/lib/org-access"
import {
  clonePersonaIntoOrganisation,
  cloneStatus,
  listPersonasVisibleTo,
  loadPersona,
  PersonaOwnershipError,
  projectsByPersona,
} from "@/lib/persona-ownership"
import { invalidatePersonaCache } from "@/lib/persona-resolution"
import { supabase } from "@/lib/supabase"

async function organisationExists(orgId: string): Promise<boolean> {
  const { data } = await supabase.from("organisations").select("id").eq("id", orgId).maybeSingle()
  return Boolean(data)
}

/** The organisation's own personas (with update status) and the Groucho personas it can use or clone. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId } = await params
  const deny = await requireOrgMember(actor, orgId)
  if (deny) return deny
  if (!(await organisationExists(orgId))) return NextResponse.json({ error: "Not found" }, { status: 404 })

  try {
    const [visible, usage, role] = await Promise.all([
      listPersonasVisibleTo(orgId),
      projectsByPersona(orgId),
      actor.kind === "platform" ? Promise.resolve("owner" as const) : fetchOrgRole(actor.userId, orgId),
    ])
    const groucho = visible.filter((persona) => persona.owner_organisation_id === null)
    const grouchoById = new Map(groucho.map((persona) => [persona.id, persona]))
    const own = visible.filter((persona) => persona.owner_organisation_id === orgId)

    // A clone's source may be a Groucho persona this organisation can no longer see; status still needs it.
    const missingSources = own
      .map((persona) => persona.source_persona_id)
      .filter((id): id is string => Boolean(id) && !grouchoById.has(id as string))
    for (const id of new Set(missingSources)) {
      const source = await loadPersona(id)
      if (source) grouchoById.set(id, source)
    }

    return NextResponse.json({
      canManage: role === "owner" || role === "admin",
      personas: own.map((persona) => {
        const source = persona.source_persona_id ? grouchoById.get(persona.source_persona_id) ?? null : null
        return { ...persona, usedBy: usage.get(persona.id) ?? [], cloneStatus: cloneStatus(persona, source) }
      }),
      library: groucho.map((persona) => ({
        id: persona.id,
        name: persona.name,
        slug: persona.slug,
        version: persona.version,
        is_active: persona.is_active,
        is_default: persona.is_default,
        visibility: persona.visibility,
        usedBy: usage.get(persona.id) ?? [],
        clones: own.filter((clone) => clone.source_persona_id === persona.id).map((clone) => clone.id),
      })),
    })
  } catch (error) {
    console.error("org personas:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}

/** Clone a Groucho persona into this organisation. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId } = await params
  const deny = await requireOrgAdmin(actor, orgId)
  if (deny) return deny

  let body: { sourcePersonaId?: unknown; name?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
  if (typeof body.sourcePersonaId !== "string" || !body.sourcePersonaId.trim()) {
    return NextResponse.json({ error: "Choose a persona to clone." }, { status: 400 })
  }

  try {
    const persona = await clonePersonaIntoOrganisation({
      sourcePersonaId: body.sourcePersonaId.trim(),
      organisationId: orgId,
      name: typeof body.name === "string" ? body.name : null,
    })
    invalidatePersonaCache()
    return NextResponse.json(persona, { status: 201 })
  } catch (error) {
    if (error instanceof PersonaOwnershipError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("clone persona:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
