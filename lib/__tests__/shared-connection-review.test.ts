import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { sharedConnectionGroup } from "@/lib/entry-review"
import { preparePresaleImport } from "@/lib/presale-import"

const db = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ supabase: db }))

type Row = Record<string, unknown>
function result(data: Row[] | Row | null, count?: number) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, count, error: null }).then(resolve),
  }
  db.from.mockReturnValueOnce(chain)
  return chain
}

const fixture = preparePresaleImport(readFileSync(new URL("../../scripts/fixtures/presale-signups.csv", import.meta.url), "utf8"), "synthetic")
function setImportedGroup(group: string, phoneFlag = true) {
  const entries = fixture.entries.filter(({ entry }) => entry.fields.connection_group === group)
  const rows = entries.map(({ entry }, i) => ({
    id: `${group}-${i}`,
    created_at: "2026-11-08T19:00:00Z",
    entry,
    applicant_name: entry.name,
    applicant_email: entry.email,
    email_matches: group === "burst-demo" && i < 2 ? 2 : 1,
    phone_matches: phoneFlag && group === "burst-demo" ? 3 : 1,
  }))
  const anchor = result({ entry: rows[0].entry, applicant_ip_hash: "import-request-hash" })
  const members = result(rows.map(({ id }) => ({ id })), rows.length)
  const review = result([...rows].reverse())
  const identifiers = result(rows.flatMap((row) => [
    { session_id: row.id, kind: "email", value: row.applicant_email },
    ...(row.entry.phone ? [{ session_id: row.id, kind: "phone", value: "7700900001" }] : []),
  ]))
  return { anchor, members, review, identifiers, rows }
}

beforeEach(() => db.from.mockReset())

describe("shared connection review", () => {
  it("keeps household evidence separate from duplicate flags and uses original signup times", async () => {
    const { anchor, members, review, identifiers } = setImportedGroup("household-demo")
    const group = await sharedConnectionGroup("org", "project", "household-demo-0")
    expect(group).toMatchObject({ source: "import", total: 3 })
    expect(group?.entries.map((row) => row.signedUpAt)).toEqual([
      "2026-11-06T10:00:00.000Z", "2026-11-06T10:02:00.000Z", "2026-11-06T10:09:00.000Z",
    ])
    expect(group?.entries.every((row) => !row.emailMatches && !row.phoneMatches)).toBe(true)
    for (const query of [anchor, members, review]) {
      expect(query.eq).toHaveBeenCalledWith("organisation_id", "org")
      expect(query.eq).toHaveBeenCalledWith("project_id", "project")
    }
    expect(members.eq).toHaveBeenCalledWith("entry->fields->>connection_group", "household-demo")
    expect(members.eq).not.toHaveBeenCalledWith("applicant_ip_hash", expect.anything())
    expect(identifiers.eq).toHaveBeenCalledWith("project_id", "project")
    expect(identifiers.in).toHaveBeenCalledWith("session_id", ["household-demo-0", "household-demo-1", "household-demo-2"])
  })

  it("shows overlap on a burst and respects a dismissed identifier flag", async () => {
    setImportedGroup("burst-demo")
    const group = await sharedConnectionGroup("org", "project", "burst-demo-0")
    expect(group?.entries.map(({ signedUpAt, emailMatches, phoneMatches }) => [signedUpAt, emailMatches, phoneMatches])).toEqual([
      ["2026-11-06T10:10:00.000Z", 2, 3],
      ["2026-11-06T10:10:01.000Z", 2, 3],
      ["2026-11-06T10:10:02.000Z", 0, 3],
    ])

    setImportedGroup("burst-demo", false)
    const dismissed = await sharedConnectionGroup("org", "project", "burst-demo-0")
    expect(dismissed?.entries.every((row) => row.phoneMatches === 0)).toBe(true)
  })

  it("looks up live groups by exact hashed address without returning the hash", async () => {
    result({ entry: null, applicant_ip_hash: "secret-hash" })
    const members = result([{ id: "a" }, { id: "b" }], 2)
    result([
      { id: "a", created_at: "2026-11-06T10:00:00Z", applicant_name: null, applicant_email: null },
      { id: "b", created_at: "2026-11-06T10:01:00Z", applicant_name: null, applicant_email: null },
    ])
    result([])
    const group = await sharedConnectionGroup("org", "project", "a")
    expect(members.eq).toHaveBeenCalledWith("applicant_ip_hash", "secret-hash")
    expect(members.is).toHaveBeenCalledWith("entry->fields->>source_registration_id", null)
    expect(group).toMatchObject({ source: "live", total: 2, entries: [{ signedUpAt: "2026-11-06T10:00:00.000Z" }, { signedUpAt: "2026-11-06T10:01:00.000Z" }] })
    expect(JSON.stringify(group)).not.toContain("secret-hash")
  })

  it("returns no evidence for an unavailable or out-of-project submission", async () => {
    result(null)
    await expect(sharedConnectionGroup("org", "project", "elsewhere")).resolves.toBeNull()
    expect(db.from).toHaveBeenCalledTimes(1)
  })
})
