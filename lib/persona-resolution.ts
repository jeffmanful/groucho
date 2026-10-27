import { supabase } from "@/lib/supabase"

export type GatekeeperPersonaRow = {
  id: string
  prompt: string
  pass_threshold: number
  reject_threshold: number
  profile_schema?: unknown
  profile_extractor_hint?: string | null
}

type CachedPersona = GatekeeperPersonaRow & {
  owner_organisation_id?: string | null
  visibility?: "all" | "restricted" | null
}

const PERSONA_CACHE_TTL_MS = 60_000
const personaCache = new Map<
  string,
  { expiresAt: number; persona: CachedPersona | null }
>()
const grantCache = new Map<string, { expiresAt: number; granted: boolean }>()

const LEGACY_PERSONA_COLUMNS =
  "id, prompt, pass_threshold, reject_threshold, profile_schema, profile_extractor_hint"
const PERSONA_COLUMNS = `${LEGACY_PERSONA_COLUMNS}, owner_organisation_id, visibility`

/** Reads with the ownership columns, falling back to the old shape if the migration is not applied yet. */
async function selectPersona(
  build: (columns: string) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<{ data: unknown; error: unknown }> {
  const result = await build(PERSONA_COLUMNS)
  const code = (result.error as { code?: string } | null)?.code
  return code === "42703" ? build(LEGACY_PERSONA_COLUMNS) : result
}

export function invalidatePersonaCache(personaId?: string): void {
  if (personaId) personaCache.delete(personaId)
  else personaCache.clear()
  personaCache.delete("__default__")
  grantCache.clear()
}

async function loadPersona(
  cacheKey: string,
  query: () => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<CachedPersona | null> {
  const cached = personaCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.persona
  const { data, error } = await query()
  const persona = error ? null : (data as CachedPersona | null)
  if (!error) {
    personaCache.set(cacheKey, {
      expiresAt: Date.now() + PERSONA_CACHE_TTL_MS,
      persona,
    })
  }
  return persona
}

async function restrictedGrant(personaId: string, organisationId: string): Promise<boolean> {
  const key = `${personaId}:${organisationId}`
  const cached = grantCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.granted
  const { data, error } = await supabase
    .from("persona_organisation_access")
    .select("persona_id")
    .eq("persona_id", personaId)
    .eq("organisation_id", organisationId)
    .maybeSingle()
  // Before the ownership migration there are no grants, and nothing is restricted.
  if (error) return (error as { code?: string }).code === "42P01"
  const granted = Boolean(data)
  grantCache.set(key, { expiresAt: Date.now() + PERSONA_CACHE_TTL_MS, granted })
  return granted
}

/**
 * Whether a project in `organisationId` may run on this persona: its own, or a Groucho persona visible
 * to it. Rows from before the ownership migration have no owner columns and stay usable.
 */
async function usableBy(persona: CachedPersona, organisationId: string | undefined): Promise<boolean> {
  if (!organisationId) return true
  const owner = persona.owner_organisation_id ?? null
  if (owner !== null) return owner === organisationId
  if (persona.visibility !== "restricted") return true
  return restrictedGrant(persona.id, organisationId)
}

function asRow(persona: CachedPersona): GatekeeperPersonaRow {
  return {
    id: persona.id,
    prompt: persona.prompt,
    pass_threshold: persona.pass_threshold,
    reject_threshold: persona.reject_threshold,
    profile_schema: persona.profile_schema,
    profile_extractor_hint: persona.profile_extractor_hint,
  }
}

async function activePersona(id: string): Promise<CachedPersona | null> {
  return loadPersona(id, () =>
    selectPersona((columns) =>
      supabase
        .from("personas")
        .select(columns)
        .eq("id", id)
        .eq("is_active", true)
        .maybeSingle(),
    ),
  )
}

async function defaultPersona(): Promise<CachedPersona | null> {
  return loadPersona("__default__", () =>
    selectPersona((columns) =>
      supabase
        .from("personas")
        .select(columns)
        .eq("is_active", true)
        .eq("is_default", true)
        .maybeSingle(),
    ),
  )
}

/**
 * The first active candidate the organisation may use, else the workspace default. The default is a
 * Groucho persona (enforced in the database) and is the platform fallback for every organisation.
 */
export async function resolveActiveGatekeeperPersona(
  candidateIds: Array<string | null | undefined>,
  organisationId?: string,
): Promise<GatekeeperPersonaRow | null> {
  const candidates = candidateIds
    .map((id) => id?.trim() ?? "")
    .filter(
      (id, index, ids): id is string =>
        Boolean(id) && ids.indexOf(id) === index,
    )
  for (const id of candidates) {
    const persona = await activePersona(id)
    if (!persona) continue
    if (await usableBy(persona, organisationId)) return asRow(persona)
    console.warn("persona_not_available_to_organisation", { personaId: id, organisationId })
  }
  const fallback = await defaultPersona()
  return fallback ? asRow(fallback) : null
}

/** The id a new session should record: the first usable active candidate, else the default. */
export async function resolveActivePersonaId(
  candidateIds: Array<string | null | undefined>,
  organisationId: string,
): Promise<string | null> {
  return (await resolveActiveGatekeeperPersona(candidateIds, organisationId))?.id ?? null
}
