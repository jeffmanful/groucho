import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { isAppleHideMyEmail } from "@/lib/applicant-identity"
import { preparePresaleImport } from "@/lib/presale-import"

const csv = readFileSync(new URL("../../scripts/fixtures/presale-signups.csv", import.meta.url), "utf8")
const fixture = preparePresaleImport(csv, "synthetic-presale")

describe("presale email labels", () => {
  it("identifies only the Apple relay in the synthetic signups", () => {
    expect(fixture.errors).toEqual([])
    expect(fixture.entries.filter(({ entry }) => isAppleHideMyEmail(entry.email))
      .map(({ entry }) => entry.fields.source_registration_id)).toEqual(["fixture-004"])
  })

  it.each([
    ["  alias@PRIVATE.ICLOUD.COM  ", true],
    ["alias@privaterelay.appleid.com", true],
    ["person@icloud.com", false],
    ["test@concu.net", false],
    ["person@private.icloud.com.example.test", false],
    ["person@@privaterelay.appleid.com", false],
    [null, false],
  ])("classifies %s by its exact domain", (email, expected) => {
    expect(isAppleHideMyEmail(email)).toBe(expected)
  })
})
