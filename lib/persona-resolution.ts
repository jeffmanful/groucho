import { supabase } from "@/lib/supabase"

export type GatekeeperPersonaRow = {
  id: string
  prompt: string
  pass_threshold: number
  reject_threshold: number
  profile_schema?: unknown
  profile_extractor_hint?: string | null
}

const PERSONA_CACHE_TTL_MS = 60_000
const personaCache = new Map<
  string,
  { expiresAt: number; persona: GatekeeperPersonaRow | null }
>()

const PERSONA_COLUMNS =
  "id, prompt, pass_threshold, reject_threshold, profile_schema, profile_extractor_hint"

export function invalidatePersonaCache(personaId?: string): void {
  if (personaId) personaCache.delete(personaId)
  else personaCache.clear()
  personaCache.delete("__default__")
}

async function loadPersona(
  cacheKey: string,
  query: () => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<GatekeeperPersonaRow | null> {
  const cached = personaCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.persona
  const { data, error } = await query()
  const persona = error ? null : (data as GatekeeperPersonaRow | null)
  if (!error) {
    personaCache.set(cacheKey, {
      expiresAt: Date.now() + PERSONA_CACHE_TTL_MS,
      persona,
    })
  }
  return persona
}

export async function resolveActiveGatekeeperPersona(
  candidateIds: Array<string | null | undefined>,
): Promise<GatekeeperPersonaRow | null> {
  const candidates = candidateIds
    .map((id) => id?.trim() ?? "")
    .filter(
      (id, index, ids): id is string =>
        Boolean(id) && ids.indexOf(id) === index,
    )
  for (const id of candidates) {
    const persona = await loadPersona(id, () =>
      supabase
        .from("personas")
        .select(PERSONA_COLUMNS)
        .eq("id", id)
        .eq("is_active", true)
        .maybeSingle(),
    )
    if (persona) return persona
  }
  return loadPersona("__default__", () =>
    supabase
      .from("personas")
      .select(PERSONA_COLUMNS)
      .eq("is_active", true)
      .eq("is_default", true)
      .maybeSingle(),
  )
}
