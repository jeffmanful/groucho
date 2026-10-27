import type { PersonaVisibility } from "@/lib/persona-ownership"
import { supabase } from "@/lib/supabase"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type PersonaAccessInput =
  | { ok: true; visibility: PersonaVisibility; organisationIds: string[] | null }
  | { ok: false; error: string }

/**
 * Visibility of a Groucho persona from a platform admin's form. `organisationIds` is null when the
 * request did not send a list, meaning "leave the current grants as they are".
 */
export function parsePersonaAccessInput(visibility: unknown, organisationIds: unknown): PersonaAccessInput {
  const parsedVisibility = visibility === undefined || visibility === null ? "all" : visibility
  if (parsedVisibility !== "all" && parsedVisibility !== "restricted") {
    return { ok: false, error: "Visibility must be all or restricted." }
  }
  if (organisationIds === undefined || organisationIds === null) {
    return { ok: true, visibility: parsedVisibility, organisationIds: null }
  }
  if (!Array.isArray(organisationIds) || organisationIds.some((id) => typeof id !== "string" || !UUID.test(id))) {
    return { ok: false, error: "Organisations must be a list of organisation ids." }
  }
  return { ok: true, visibility: parsedVisibility, organisationIds: [...new Set(organisationIds as string[])] }
}

/**
 * Replaces the organisations that can see a restricted Groucho persona. New grants are added before old
 * ones are removed, so an organisation that keeps access never loses it part-way.
 */
export async function replacePersonaAccess(personaId: string, organisationIds: string[]): Promise<void> {
  if (organisationIds.length) {
    const { error } = await supabase
      .from("persona_organisation_access")
      .upsert(
        organisationIds.map((organisationId) => ({ persona_id: personaId, organisation_id: organisationId })),
        { onConflict: "persona_id,organisation_id", ignoreDuplicates: true },
      )
    if (error) throw error
  }
  let removal = supabase.from("persona_organisation_access").delete().eq("persona_id", personaId)
  if (organisationIds.length) removal = removal.not("organisation_id", "in", `(${organisationIds.join(",")})`)
  const { error } = await removal
  if (error) throw error
}

/**
 * Organisations whose projects use this Groucho persona as is but would lose sight of it with the given
 * visibility. Restricting it under them would silently move those projects to the workspace default.
 */
export async function organisationsLosingPersona(
  personaId: string,
  visibility: "all" | "restricted",
  organisationIds: string[],
): Promise<string[]> {
  if (visibility === "all") return []
  const { data, error } = await supabase
    .from("projects")
    .select("organisation_id")
    .eq("settings->>persona_id", personaId)
  if (error) throw error
  return [...new Set((data ?? []).map((row) => row.organisation_id as string))].filter((id) => !organisationIds.includes(id))
}
