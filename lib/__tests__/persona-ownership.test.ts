import { beforeEach, describe, expect, it, vi } from "vitest"

type Row = Record<string, unknown>

const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, nextId: 1 }))

vi.mock("@/lib/supabase", () => {
  function query(table: string) {
    const filters: Array<(row: Row) => boolean> = []
    let mode: "select" | "update" | "delete" | "insert" = "select"
    let patch: Row = {}
    let inserted: Row[] = []
    const rows = () => (db.tables[table] ??= [])
    const matching = () => rows().filter((row) => filters.every((filter) => filter(row)))
    const run = () => {
      if (mode === "insert") return inserted
      if (mode === "update") {
        const hit = matching()
        for (const row of hit) {
          const contentChanged = ["name", "prompt", "pass_threshold", "reject_threshold", "profile_schema", "profile_extractor_hint"]
            .some((key) => key in patch && JSON.stringify(patch[key]) !== JSON.stringify(row[key]))
          Object.assign(row, patch)
          if (table === "personas" && contentChanged) row.version = (row.version as number) + 1
        }
        return hit
      }
      if (mode === "delete") {
        const hit = matching()
        db.tables[table] = rows().filter((row) => !hit.includes(row))
        return hit
      }
      return matching()
    }
    const chain = {
      select: () => chain,
      order: () => chain,
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), chain),
      neq: (column: string, value: unknown) => (filters.push((row) => row[column] !== value), chain),
      is: (column: string, value: unknown) => (filters.push((row) => (row[column] ?? null) === value), chain),
      in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), chain),
      insert(values: Row | Row[]) {
        mode = "insert"
        const list = Array.isArray(values) ? values : [values]
        for (const value of list) {
          if (table === "personas" && rows().some((row) => row.slug === value.slug)) {
            inserted = []
            ;(chain as { error?: unknown }).error = { code: "23505" }
            return chain
          }
        }
        inserted = list.map((value) => ({
          id: `new-${db.nextId++}`,
          created_at: "2026-10-27T00:00:00Z",
          updated_at: "2026-10-27T00:00:00Z",
          ...(table === "personas" ? { version: 1, owner_organisation_id: null, source_persona_id: null, source_version: null, visibility: "all" } : {}),
          ...value,
        }))
        rows().push(...inserted)
        return chain
      },
      update(values: Row) {
        mode = "update"
        patch = values
        return chain
      },
      delete() {
        mode = "delete"
        return chain
      },
      async maybeSingle() {
        const error = (chain as { error?: unknown }).error
        if (error) return { data: null, error }
        return { data: run()[0] ?? null, error: null }
      },
      async single() {
        const error = (chain as { error?: unknown }).error
        if (error) return { data: null, error }
        const result = run()
        return result[0] ? { data: result[0], error: null } : { data: null, error: { message: "no row" } }
      },
      then(resolve: (value: { data: Row[]; error: unknown }) => unknown) {
        const error = (chain as { error?: unknown }).error
        return Promise.resolve(error ? { data: null, error } : { data: run(), error: null }).then(resolve as never)
      },
    }
    return chain
  }
  return { supabase: { from: query } }
})

import {
  acceptSourceUpdate,
  changedContentFields,
  clonePersonaIntoOrganisation,
  cloneSlug,
  cloneStatus,
  listPersonasVisibleTo,
  PersonaOwnershipError,
  personaVisibleTo,
  projectPersonaChoiceError,
} from "@/lib/persona-ownership"
import { parsePersonaAccessInput } from "@/lib/persona-access-input"
import { invalidatePersonaCache, resolveActiveGatekeeperPersona } from "@/lib/persona-resolution"

const COLORS = "org-colors"
const JACOB = "org-jacob"

function persona(overrides: Row): Row {
  return {
    is_active: true,
    is_default: false,
    pass_threshold: 0.65,
    reject_threshold: 0.25,
    profile_schema: null,
    profile_extractor_hint: null,
    owner_organisation_id: null,
    source_persona_id: null,
    source_version: null,
    version: 1,
    visibility: "all",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...overrides,
  }
}

beforeEach(() => {
  invalidatePersonaCache()
  db.nextId = 1
  db.tables = {
    organisations: [
      { id: COLORS, name: "COLORS", slug: "colors" },
      { id: JACOB, name: "JacobCorp", slug: "jacobcorp" },
    ],
    personas: [
      persona({ id: "forum", name: "COLORS Forum", slug: "colors-forum", prompt: "forum v2", visibility: "restricted", version: 2 }),
      persona({ id: "groucho", name: "COLORS GROUCHO", slug: "colors-groucho", prompt: "groucho", visibility: "restricted", is_default: true }),
      persona({ id: "lou", name: "Lou", slug: "lou", prompt: "lou" }),
      persona({
        id: "colors-forum-clone", name: "Forum (ours)", slug: "colors-colors-forum", prompt: "forum v1",
        owner_organisation_id: COLORS, source_persona_id: "forum", source_version: 1, visibility: "restricted",
      }),
      persona({ id: "jacob-own", name: "Jacob voice", slug: "jacob-voice", prompt: "jacob", owner_organisation_id: JACOB, visibility: "restricted" }),
    ],
    persona_organisation_access: [
      { persona_id: "forum", organisation_id: COLORS },
      { persona_id: "groucho", organisation_id: COLORS },
      { persona_id: "groucho", organisation_id: JACOB },
    ],
    projects: [],
  }
})

describe("visibility and clone status", () => {
  it("lets an organisation see its own personas, open Groucho personas and restricted ones granted to it", () => {
    expect(personaVisibleTo({ owner_organisation_id: COLORS, visibility: "restricted" }, COLORS, [])).toBe(true)
    expect(personaVisibleTo({ owner_organisation_id: COLORS, visibility: "restricted" }, JACOB, [])).toBe(false)
    expect(personaVisibleTo({ owner_organisation_id: null, visibility: "all" }, JACOB, [])).toBe(true)
    expect(personaVisibleTo({ owner_organisation_id: null, visibility: "restricted" }, JACOB, [COLORS])).toBe(false)
    expect(personaVisibleTo({ owner_organisation_id: null, visibility: "restricted" }, COLORS, [COLORS])).toBe(true)
  })

  it("reports when a clone is behind its original", () => {
    expect(cloneStatus({ source_persona_id: null, source_version: null }, null).state).toBe("not_a_clone")
    expect(cloneStatus({ source_persona_id: "a", source_version: 1 }, { id: "a", name: "A", version: 2 })).toMatchObject({
      state: "update_available", clonedFromVersion: 1, latestVersion: 2,
    })
    expect(cloneStatus({ source_persona_id: "a", source_version: 2 }, { id: "a", name: "A", version: 2 }).state).toBe("up_to_date")
    expect(cloneStatus({ source_persona_id: "a", source_version: 2 }, null).state).toBe("source_removed")
  })

  it("lists the content fields that differ", () => {
    const base = { name: "A", prompt: "p", pass_threshold: 0.6, reject_threshold: 0.2, profile_schema: { a: 1 }, profile_extractor_hint: null }
    expect(changedContentFields(base, { ...base, prompt: "q", profile_schema: { a: 2 } })).toEqual(["prompt", "profile_schema"])
  })

  it("builds clone slugs from the organisation", () => {
    expect(cloneSlug("colors", COLORS, "lou", 0)).toBe("colors-lou")
    expect(cloneSlug(null, "abcdef12-0000", "lou", 1)).toBe("abcdef12-lou-2")
  })

  it("parses visibility input", () => {
    expect(parsePersonaAccessInput(undefined, undefined)).toEqual({ ok: true, visibility: "all", organisationIds: null })
    expect(parsePersonaAccessInput("restricted", ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000001"]))
      .toEqual({ ok: true, visibility: "restricted", organisationIds: ["00000000-0000-0000-0000-000000000001"] })
    expect(parsePersonaAccessInput("public", undefined).ok).toBe(false)
    expect(parsePersonaAccessInput("restricted", ["not-an-id"]).ok).toBe(false)
  })
})

describe("listing, cloning and updating", () => {
  it("shows each organisation only what it may use", async () => {
    const colors = (await listPersonasVisibleTo(COLORS)).map((row) => row.id).sort()
    const jacob = (await listPersonasVisibleTo(JACOB)).map((row) => row.id).sort()
    expect(colors).toEqual(["colors-forum-clone", "forum", "groucho", "lou"])
    expect(jacob).toEqual(["groucho", "jacob-own", "lou"])
  })

  it("clones a visible Groucho persona with its content and provenance", async () => {
    const clone = await clonePersonaIntoOrganisation({ sourcePersonaId: "lou", organisationId: JACOB })
    expect(clone).toMatchObject({
      name: "Lou", prompt: "lou", slug: "jacobcorp-lou", owner_organisation_id: JACOB,
      source_persona_id: "lou", source_version: 1, is_default: false,
    })
  })

  it("picks another slug when the first is taken", async () => {
    db.tables.personas.push(persona({ id: "taken", name: "x", slug: "jacobcorp-lou", prompt: "x", owner_organisation_id: JACOB }))
    const clone = await clonePersonaIntoOrganisation({ sourcePersonaId: "lou", organisationId: JACOB, name: "Our Lou" })
    expect(clone).toMatchObject({ slug: "jacobcorp-lou-2", name: "Our Lou" })
  })

  it("refuses personas the organisation cannot see, and clones of clones", async () => {
    await expect(clonePersonaIntoOrganisation({ sourcePersonaId: "forum", organisationId: JACOB })).rejects.toMatchObject({ status: 404 })
    await expect(clonePersonaIntoOrganisation({ sourcePersonaId: "jacob-own", organisationId: COLORS })).rejects.toMatchObject({ status: 404 })
    await expect(clonePersonaIntoOrganisation({ sourcePersonaId: "colors-forum-clone", organisationId: COLORS })).rejects.toBeInstanceOf(PersonaOwnershipError)
  })

  it("accepts an update only against the version that was reviewed, keeping the clone's name", async () => {
    await expect(acceptSourceUpdate({ personaId: "colors-forum-clone", organisationId: COLORS, expectedVersion: 1 }))
      .rejects.toMatchObject({ status: 409 })
    const updated = await acceptSourceUpdate({ personaId: "colors-forum-clone", organisationId: COLORS, expectedVersion: 2 })
    expect(updated).toMatchObject({ name: "Forum (ours)", prompt: "forum v2", source_version: 2 })
  })

  it("never updates another organisation's clone", async () => {
    await expect(acceptSourceUpdate({ personaId: "colors-forum-clone", organisationId: JACOB, expectedVersion: 2 }))
      .rejects.toMatchObject({ status: 404 })
  })

  it("checks a project's persona choice only when it changes", async () => {
    expect(await projectPersonaChoiceError({ persona_id: "jacob-own" }, COLORS)).toMatch(/Choose one/)
    expect(await projectPersonaChoiceError({ persona_id: "forum" }, COLORS)).toBeNull()
    expect(await projectPersonaChoiceError({ persona_id: "forum" }, JACOB, { persona_id: "forum" })).toBeNull()
    expect(await projectPersonaChoiceError({}, JACOB)).toBeNull()
  })
})

describe("conversation persona resolution", () => {
  it("ignores a persona the organisation may not use and falls back to the project's", async () => {
    const resolved = await resolveActiveGatekeeperPersona(["jacob-own", "colors-forum-clone"], COLORS)
    expect(resolved?.id).toBe("colors-forum-clone")
  })

  it("uses restricted Groucho personas only where granted, then the workspace default", async () => {
    expect((await resolveActiveGatekeeperPersona(["forum"], COLORS))?.id).toBe("forum")
    expect((await resolveActiveGatekeeperPersona(["forum"], JACOB))?.id).toBe("groucho")
  })
})
