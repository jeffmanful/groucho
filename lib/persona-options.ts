// Client-side persona choices for a project: the organisation's own personas first, then Groucho's.

export type PersonaOption = {
  id: string
  name: string
  slug: string
  is_active: boolean
  is_default: boolean
  /** "own": belongs to this organisation. "groucho": a Groucho persona used as is. */
  kind: "own" | "groucho"
  updateAvailable: boolean
}

type OrgPersonasResponse = {
  personas?: Array<{
    id: string
    name: string
    slug: string
    is_active: boolean
    is_default: boolean
    cloneStatus?: { state?: string }
  }>
  library?: Array<{ id: string; name: string; slug: string; is_active: boolean; is_default: boolean }>
}

export function personaOptionsFrom(body: OrgPersonasResponse): PersonaOption[] {
  return [
    ...(body.personas ?? []).map((persona) => ({
      id: persona.id,
      name: persona.name,
      slug: persona.slug,
      is_active: persona.is_active,
      is_default: persona.is_default,
      kind: "own" as const,
      updateAvailable: persona.cloneStatus?.state === "update_available",
    })),
    ...(body.library ?? []).map((persona) => ({
      id: persona.id,
      name: persona.name,
      slug: persona.slug,
      is_active: persona.is_active,
      is_default: persona.is_default,
      kind: "groucho" as const,
      updateAvailable: false,
    })),
  ]
}

export async function fetchPersonaOptions(orgId: string): Promise<PersonaOption[]> {
  const res = await fetch(`/api/admin/organisations/${orgId}/personas`, { credentials: "same-origin", cache: "no-store" })
  if (!res.ok) return []
  return personaOptionsFrom((await res.json()) as OrgPersonasResponse)
}

/** The persona a new project starts on: the organisation's first active one, else the Groucho default. */
export function defaultPersonaOption(options: PersonaOption[]): PersonaOption | undefined {
  return (
    options.find((option) => option.kind === "own" && option.is_active) ??
    options.find((option) => option.is_default && option.is_active) ??
    options.find((option) => option.is_active) ??
    options[0]
  )
}

/** Where to save changes to a persona: the organisation route for its own, the platform route for Groucho's. */
export function personaUpdateUrl(option: Pick<PersonaOption, "id" | "kind">, orgId: string): string {
  return option.kind === "own"
    ? `/api/admin/organisations/${orgId}/personas/${option.id}`
    : `/api/admin/personas/${option.id}`
}
