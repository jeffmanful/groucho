import { describe, expect, it } from "vitest"
import { applicantIdentityFromRow, applicantIdentityPayload, parseApplicantIdentity } from "@/lib/applicant-identity"

const artist = { city: "Example City", age: 24, socialLinks: [], musicLinks: [] }
const applicant = { email: "artist@example.com", name: "Example Artist", artist }

describe("structured artist intake", () => {
  it("round trips community details without treating music links as an artist application", () => {
    const identity = { email: "member@example.com", name: "Example Member", details: { ...artist, musicLinks: ["https://example.com/favourite"] } }
    expect(parseApplicantIdentity(identity)).toEqual({ ok: true, value: identity })
    const row = applicantIdentityPayload(identity)
    expect(row).toMatchObject({ application_audience: "community", applicant_details: identity.details })
    expect(applicantIdentityFromRow(row)).toEqual(identity)
  })
  it("requires a name for community intake and rejects conflicting audiences", () => {
    expect(parseApplicantIdentity({ email: applicant.email, details: artist }).ok).toBe(false)
    expect(parseApplicantIdentity({ ...applicant, details: artist }).ok).toBe(false)
  })
  it("keeps email-only callers compatible", () => {
    expect(parseApplicantIdentity({ email: "  PERSON@EXAMPLE.COM " })).toEqual({ ok: true, value: { email: "person@example.com" } })
  })
  it("accepts no artist name or public links", () => {
    expect(parseApplicantIdentity(applicant)).toEqual({ ok: true, value: applicant })
  })
  it("defaults missing link lists to empty instead of excluding unreleased artists", () => {
    expect(parseApplicantIdentity({ ...applicant, artist: { city: "Example City", age: 24 } })).toEqual({ ok: true, value: applicant })
  })
  it("round trips submitted facts through the storage envelope without model extraction", () => {
    const result = parseApplicantIdentity({ ...applicant, artist: { ...artist, artistName: " Example Name ", socialLinks: ["https://example.com/profile", "https://example.com/profile"], musicLinks: ["https://example.org/music"] } })
    expect(result.ok).toBe(true)
    if (!result.ok || !result.value) throw new Error("Expected identity")
    const row = applicantIdentityPayload(result.value)
    expect(applicantIdentityFromRow(row)).toEqual(result.value)
    expect(result.value.artist?.socialLinks).toHaveLength(1)
    expect(result.value.artist?.artistName).toBe("Example Name")
  })
  it.each([undefined, "", " "])("requires a name for artist intake: %s", (name) => {
    expect(parseApplicantIdentity({ ...applicant, name }).ok).toBe(false)
  })
  it.each([-1, 121, 24.5, "24", null])("rejects invalid age without inventing an eligibility threshold: %s", (age) => {
    expect(parseApplicantIdentity({ ...applicant, artist: { ...artist, age } }).ok).toBe(false)
  })
  it.each(["", " ", "x".repeat(121)])("requires a bounded city: %s", (city) => {
    expect(parseApplicantIdentity({ ...applicant, artist: { ...artist, city } }).ok).toBe(false)
  })
  it.each(["javascript:alert(1)", "data:text/html,test", "not a link", "https://name:password@example.com/"])("rejects unsafe or incomplete links: %s", (url) => {
    expect(parseApplicantIdentity({ ...applicant, artist: { ...artist, socialLinks: [url] } }).ok).toBe(false)
  })
  it("limits list size and artist name length", () => {
    expect(parseApplicantIdentity({ ...applicant, artist: { ...artist, socialLinks: Array(9).fill("https://example.com/") } }).ok).toBe(false)
    expect(parseApplicantIdentity({ ...applicant, artist: { ...artist, artistName: "x".repeat(161) } }).ok).toBe(false)
  })
  it("does not promote malformed stored data to artist mode", () => {
    expect(applicantIdentityFromRow({ applicant_email: applicant.email, applicant_details: { city: "Test", age: "invalid" } })).toEqual({ email: applicant.email })
  })
})
