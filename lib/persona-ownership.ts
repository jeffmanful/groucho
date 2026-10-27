// Persona ownership: Groucho personas, organisation clones, visibility and updates.
// See docs/persona-ownership.md.
import { supabase } from "@/lib/supabase"

export type PersonaVisibility = "all" | "restricted"

/** The content of a persona. Copying these fields is what a clone or an accepted update does. */
export const PERSONA_CONTENT_FIELDS = [
  "name",
  "prompt",
  "pass_threshold",
  "reject_threshold",
  "profile_schema",
  "profile_extractor_hint",
] as const

export type PersonaContent = {
  name: string
  prompt: string
  pass_threshold: number
  reject_threshold: number
  profile_schema: unknown
  profile_extractor_hint: string | null
}

export type PersonaRecord = PersonaContent & {
  id: string
  slug: string
  is_active: boolean
  is_default: boolean
  owner_organisation_id: string | null
  source_persona_id: string | null
  source_version: number | null
  version: number
  visibility: PersonaVisibility
  created_at: string
  updated_at: string
}

export const PERSONA_RECORD_COLUMNS =
  "id, slug, name, prompt, is_active, is_default, pass_threshold, reject_threshold, profile_schema, profile_extractor_hint, owner_organisation_id, source_persona_id, source_version, version, visibility, created_at, updated_at"

export type CloneState = "not_a_clone" | "up_to_date" | "update_available" | "source_removed"

export type CloneStatus = {
  state: CloneState
  sourcePersonaId: string | null
  sourceName: string | null
  /** Version of the source this clone last took its content from. */
  clonedFromVersion: number | null
  /** The source's current version. */
  latestVersion: number | null
}

export function isGrouchoPersona(persona: Pick<PersonaRecord, "owner_organisation_id">): boolean {
  return persona.owner_organisation_id === null
}

/** Whether a persona row may be used by (and shown to) an organisation, given its access grants. */
export function personaVisibleTo(
  persona: Pick<PersonaRecord, "owner_organisation_id" | "visibility">,
  organisationId: string,
  grantedOrganisationIds: readonly string[],
): boolean {
  if (persona.owner_organisation_id !== null) return persona.owner_organisation_id === organisationId
  if (persona.visibility === "all") return true
  return grantedOrganisationIds.includes(organisationId)
}

export function cloneStatus(
  persona: Pick<PersonaRecord, "source_persona_id" | "source_version">,
  source: Pick<PersonaRecord, "id" | "name" | "version"> | null,
): CloneStatus {
  if (!persona.source_persona_id) {
    return { state: "not_a_clone", sourcePersonaId: null, sourceName: null, clonedFromVersion: null, latestVersion: null }
  }
  if (!source) {
    return {
      state: "source_removed",
      sourcePersonaId: persona.source_persona_id,
      sourceName: null,
      clonedFromVersion: persona.source_version,
      latestVersion: null,
    }
  }
  const behind = (persona.source_version ?? 0) < source.version
  return {
    state: behind ? "update_available" : "up_to_date",
    sourcePersonaId: source.id,
    sourceName: source.name,
    clonedFromVersion: persona.source_version,
    latestVersion: source.version,
  }
}

export function personaContent(persona: PersonaContent): PersonaContent {
  return {
    name: persona.name,
    prompt: persona.prompt,
    pass_threshold: persona.pass_threshold,
    reject_threshold: persona.reject_threshold,
    profile_schema: persona.profile_schema ?? null,
    profile_extractor_hint: persona.profile_extractor_hint ?? null,
  }
}

/** Fields that differ between two versions of a persona's content, for the update comparison. */
export function changedContentFields(current: PersonaContent, incoming: PersonaContent): Array<(typeof PERSONA_CONTENT_FIELDS)[number]> {
  return PERSONA_CONTENT_FIELDS.filter(
    (field) => JSON.stringify(current[field] ?? null) !== JSON.stringify(incoming[field] ?? null),
  )
}

export function cloneSlug(organisationSlug: string | null, organisationId: string, sourceSlug: string, attempt: number): string {
  const prefix = (organisationSlug?.trim() || organisationId.slice(0, 8)).toLowerCase()
  const base = `${prefix}-${sourceSlug}`
  return attempt === 0 ? base : `${base}-${attempt + 1}`
}

async function grantsFor(personaIds: string[]): Promise<Map<string, string[]>> {
  const grants = new Map<string, string[]>()
  if (!personaIds.length) return grants
  const { data, error } = await supabase
    .from("persona_organisation_access")
    .select("persona_id, organisation_id")
    .in("persona_id", personaIds)
  if (error) throw error
  for (const row of data ?? []) {
    const list = grants.get(row.persona_id) ?? []
    list.push(row.organisation_id)
    grants.set(row.persona_id, list)
  }
  return grants
}

/** Every persona an organisation can see: its own, and the Groucho personas visible to it. */
export async function listPersonasVisibleTo(organisationId: string): Promise<PersonaRecord[]> {
  const [{ data: own, error: ownError }, { data: groucho, error: grouchoError }] = await Promise.all([
    supabase.from("personas").select(PERSONA_RECORD_COLUMNS).eq("owner_organisation_id", organisationId).order("name"),
    supabase.from("personas").select(PERSONA_RECORD_COLUMNS).is("owner_organisation_id", null).order("name"),
  ])
  if (ownError) throw ownError
  if (grouchoError) throw grouchoError
  const grouchoRows = (groucho ?? []) as PersonaRecord[]
  const grants = await grantsFor(grouchoRows.filter((row) => row.visibility === "restricted").map((row) => row.id))
  return [
    ...((own ?? []) as PersonaRecord[]),
    ...grouchoRows.filter((row) => personaVisibleTo(row, organisationId, grants.get(row.id) ?? [])),
  ]
}

/** Personas visible to any of several organisations (an organisation member's persona picker). */
export async function listPersonasVisibleToAny(organisationIds: string[]): Promise<PersonaRecord[]> {
  const lists = await Promise.all(organisationIds.map((id) => listPersonasVisibleTo(id)))
  const seen = new Map<string, PersonaRecord>()
  for (const row of lists.flat()) seen.set(row.id, row)
  return [...seen.values()]
}

export async function loadPersona(personaId: string): Promise<PersonaRecord | null> {
  const { data, error } = await supabase.from("personas").select(PERSONA_RECORD_COLUMNS).eq("id", personaId).maybeSingle()
  if (error) throw error
  return (data as PersonaRecord | null) ?? null
}

/** Whether a project in this organisation may run on this persona. */
export async function personaUsableByOrganisation(personaId: string, organisationId: string): Promise<boolean> {
  const persona = await loadPersona(personaId)
  if (!persona) return false
  if (persona.owner_organisation_id !== null || persona.visibility === "all") {
    return personaVisibleTo(persona, organisationId, [])
  }
  const grants = await grantsFor([persona.id])
  return personaVisibleTo(persona, organisationId, grants.get(persona.id) ?? [])
}

export class PersonaOwnershipError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** Copies a visible Groucho persona into an organisation. */
export async function clonePersonaIntoOrganisation(input: {
  sourcePersonaId: string
  organisationId: string
  name?: string | null
}): Promise<PersonaRecord> {
  const source = await loadPersona(input.sourcePersonaId)
  if (!source || !(await personaUsableByOrganisation(source.id, input.organisationId))) {
    throw new PersonaOwnershipError("Persona not found", 404)
  }
  if (!isGrouchoPersona(source)) {
    throw new PersonaOwnershipError("Only Groucho personas can be cloned", 400)
  }
  const { data: organisation, error: organisationError } = await supabase
    .from("organisations")
    .select("id, slug")
    .eq("id", input.organisationId)
    .maybeSingle()
  if (organisationError) throw organisationError
  if (!organisation) throw new PersonaOwnershipError("Organisation not found", 404)

  const name = input.name?.trim() || source.name
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await supabase
      .from("personas")
      .insert({
        ...personaContent(source),
        name,
        slug: cloneSlug(organisation.slug ?? null, organisation.id, source.slug, attempt),
        is_active: source.is_active,
        is_default: false,
        owner_organisation_id: organisation.id,
        source_persona_id: source.id,
        source_version: source.version,
        visibility: "restricted",
      })
      .select(PERSONA_RECORD_COLUMNS)
      .single()
    if (!error) return data as PersonaRecord
    if (error.code !== "23505") throw error
  }
  throw new PersonaOwnershipError("Could not choose a unique slug for the clone", 409)
}

/**
 * Replaces a clone's content with its source's current content. `expectedVersion` is the source
 * version the person compared against, so an update published meanwhile is never accepted unseen.
 */
export async function acceptSourceUpdate(input: {
  personaId: string
  organisationId: string
  expectedVersion: number
}): Promise<PersonaRecord> {
  const persona = await loadPersona(input.personaId)
  if (!persona || persona.owner_organisation_id !== input.organisationId) {
    throw new PersonaOwnershipError("Persona not found", 404)
  }
  if (!persona.source_persona_id) throw new PersonaOwnershipError("This persona is not a clone", 400)
  const source = await loadPersona(persona.source_persona_id)
  if (!source) throw new PersonaOwnershipError("The original persona no longer exists", 409)
  if (!(await personaUsableByOrganisation(source.id, input.organisationId))) {
    throw new PersonaOwnershipError("The original persona is no longer available to this organisation", 403)
  }
  if (source.version !== input.expectedVersion) {
    throw new PersonaOwnershipError("The original changed again. Review the latest version first.", 409)
  }
  // Keep the clone's own name: it is how the organisation refers to it.
  const { name: _sourceName, ...content } = personaContent(source)
  void _sourceName
  const { data, error } = await supabase
    .from("personas")
    .update({ ...content, source_version: source.version, updated_at: new Date().toISOString() })
    .eq("id", persona.id)
    .eq("owner_organisation_id", input.organisationId)
    .select(PERSONA_RECORD_COLUMNS)
    .single()
  if (error) throw error
  return data as PersonaRecord
}

/** Projects in an organisation, keyed by the persona they use. */
export async function projectsByPersona(organisationId: string): Promise<Map<string, Array<{ id: string; name: string }>>> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, settings")
    .eq("organisation_id", organisationId)
    .order("name")
  if (error) throw error
  const byPersona = new Map<string, Array<{ id: string; name: string }>>()
  for (const project of data ?? []) {
    const settings = project.settings as Record<string, unknown> | null
    const personaId = typeof settings?.persona_id === "string" ? settings.persona_id : null
    if (!personaId) continue
    const list = byPersona.get(personaId) ?? []
    list.push({ id: project.id, name: project.name })
    byPersona.set(personaId, list)
  }
  return byPersona
}

/**
 * A project's chosen persona must be its organisation's own or a Groucho persona visible to it.
 * Only a changed choice is checked, so saving other settings never fails on an older project.
 */
export async function projectPersonaChoiceError(
  settings: Record<string, unknown>,
  organisationId: string,
  previousSettings: Record<string, unknown> | null = null,
): Promise<string | null> {
  const personaId = typeof settings.persona_id === "string" ? settings.persona_id.trim() : ""
  if (!personaId) return null
  if (previousSettings && previousSettings.persona_id === settings.persona_id) return null
  try {
    return (await personaUsableByOrganisation(personaId, organisationId))
      ? null
      : "Choose one of this organisation's personas, or a Groucho persona available to it."
  } catch (error) {
    // Ownership migration not applied yet: every persona is still shared, so there is nothing to check.
    if ((error as { code?: string } | null)?.code === "42703") return null
    throw error
  }
}
