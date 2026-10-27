import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requireOrgAdmin, requireOrgMember, unauthorized } from "@/lib/org-access"
import {
  changedContentFields,
  cloneStatus,
  loadPersona,
  personaContent,
  personaUsableByOrganisation,
  PERSONA_RECORD_COLUMNS,
  projectsByPersona,
} from "@/lib/persona-ownership"
import { normaliseExtractorHint, parseProfileSchemaInput } from "@/lib/persona-profile-schema"
import { invalidatePersonaCache } from "@/lib/persona-resolution"
import { supabase } from "@/lib/supabase"

type Params = { params: Promise<{ orgId: string; personaId: string }> }

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 })

/** One persona this organisation can see; for a clone, the original's current content to compare. */
export async function GET(_req: NextRequest, { params }: Params) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, personaId } = await params
  const deny = await requireOrgMember(actor, orgId)
  if (deny) return deny

  try {
    const persona = await loadPersona(personaId)
    if (!persona || !(await personaUsableByOrganisation(personaId, orgId))) return notFound()
    // The original's content is shown only while the organisation can still see it.
    const sourceRow = persona.source_persona_id ? await loadPersona(persona.source_persona_id) : null
    const source = sourceRow && (await personaUsableByOrganisation(sourceRow.id, orgId)) ? sourceRow : null
    const usage = await projectsByPersona(orgId)
    return NextResponse.json({
      persona,
      editable: persona.owner_organisation_id === orgId,
      usedBy: usage.get(persona.id) ?? [],
      cloneStatus: cloneStatus(persona, sourceRow),
      source: source
        ? {
            id: source.id,
            version: source.version,
            content: personaContent(source),
            changedFields: changedContentFields(personaContent(persona), personaContent(source)).filter((field) => field !== "name"),
          }
        : null,
    })
  } catch (error) {
    console.error("org persona:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}

/** Edit one of the organisation's own personas. Groucho personas are edited by platform admins only. */
export async function PUT(req: NextRequest, { params }: Params) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, personaId } = await params
  const deny = await requireOrgAdmin(actor, orgId)
  if (deny) return deny

  let body: {
    name?: unknown
    prompt?: unknown
    is_active?: unknown
    pass_threshold?: unknown
    reject_threshold?: unknown
    profile_schema?: unknown
    profile_extractor_hint?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const name = typeof body.name === "string" ? body.name.trim() : ""
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : ""
  if (!name || !prompt) return NextResponse.json({ error: "Name and prompt are required." }, { status: 400 })
  const threshold = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback
  const parsedSchema = parseProfileSchemaInput(body.profile_schema)
  if (!parsedSchema.ok) return NextResponse.json({ error: parsedSchema.error }, { status: 400 })

  try {
    const persona = await loadPersona(personaId)
    if (!persona) return notFound()
    if (persona.owner_organisation_id !== orgId) {
      if (await personaUsableByOrganisation(personaId, orgId)) {
        return NextResponse.json({ error: "This is a Groucho persona. Clone it to make changes." }, { status: 403 })
      }
      return notFound()
    }
    const { data, error } = await supabase
      .from("personas")
      .update({
        name,
        prompt,
        is_active: typeof body.is_active === "boolean" ? body.is_active : persona.is_active,
        pass_threshold: threshold(body.pass_threshold, persona.pass_threshold),
        reject_threshold: threshold(body.reject_threshold, persona.reject_threshold),
        profile_schema: parsedSchema.value,
        profile_extractor_hint: normaliseExtractorHint(body.profile_extractor_hint),
        updated_at: new Date().toISOString(),
      })
      .eq("id", personaId)
      .eq("owner_organisation_id", orgId)
      .select(PERSONA_RECORD_COLUMNS)
      .single()
    if (error) throw error
    invalidatePersonaCache(personaId)
    return NextResponse.json(data)
  } catch (error) {
    console.error("update org persona:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}

/** Remove one of the organisation's own personas, if no project or past session uses it. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, personaId } = await params
  const deny = await requireOrgAdmin(actor, orgId)
  if (deny) return deny

  try {
    const persona = await loadPersona(personaId)
    if (!persona || persona.owner_organisation_id !== orgId) return notFound()
    const usage = await projectsByPersona(orgId)
    const projects = usage.get(personaId) ?? []
    if (projects.length) {
      return NextResponse.json(
        { error: `Used by ${projects.map((project) => project.name).join(", ")}. Choose another persona for ${projects.length === 1 ? "that project" : "those projects"} first.` },
        { status: 409 },
      )
    }
    const { count } = await supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("persona_id", personaId)
    if (count && count > 0) {
      return NextResponse.json(
        { error: `Cannot delete: ${count} past conversation${count === 1 ? "" : "s"} used this persona. Switch it off instead.` },
        { status: 409 },
      )
    }
    const { error } = await supabase.from("personas").delete().eq("id", personaId).eq("owner_organisation_id", orgId)
    if (error) throw error
    invalidatePersonaCache(personaId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("delete org persona:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
