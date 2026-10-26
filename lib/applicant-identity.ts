export type ApplicantDetails = {
  city: string
  age: number
  artistName?: string
  socialLinks: string[]
  musicLinks: string[]
}

export type ArtistApplicantProfile = ApplicantDetails

export type ApplicantIdentity = {
  email: string
  name?: string
  details?: ApplicantDetails
  artist?: ArtistApplicantProfile
}

export type ParsedApplicantIdentity =
  | { ok: true; value: ApplicantIdentity | null }
  | { ok: false; error: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_LINKS = 8

export function normaliseApplicantEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

function parseLinks(raw: unknown, field: string): string[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > MAX_LINKS) {
    throw new Error(`${field} must be a list of up to ${MAX_LINKS} links`)
  }
  return [...new Set(raw.map((item) => {
    if (typeof item !== "string" || item.trim().length > 2048) {
      throw new Error(`${field} must contain valid web links`)
    }
    let url: URL
    try { url = new URL(item.trim()) } catch {
      throw new Error(`${field} must contain complete http or https links`)
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error(`${field} must contain complete http or https links without credentials`)
    }
    return url.href
  }))]
}

export function parseApplicantDetails(raw: unknown): ApplicantDetails {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Applicant details must be an object")
  }
  const value = raw as Record<string, unknown>
  const city = typeof value.city === "string" ? value.city.trim() : ""
  if (!city || city.length > 120) throw new Error("City is required and must be 120 characters or fewer")
  if (typeof value.age !== "number" || !Number.isInteger(value.age) || value.age < 0 || value.age > 120) {
    throw new Error("Age must be a whole number between 0 and 120")
  }
  if (value.artistName !== undefined && typeof value.artistName !== "string") {
    throw new Error("Artist name must be text")
  }
  const artistName = typeof value.artistName === "string" ? value.artistName.trim() : ""
  if (artistName.length > 160) throw new Error("Artist name must be 160 characters or fewer")
  return {
    city,
    age: value.age,
    ...(artistName ? { artistName } : {}),
    socialLinks: parseLinks(value.socialLinks, "Social links"),
    musicLinks: parseLinks(value.musicLinks, "Music streaming links"),
  }
}

export const parseArtistApplicantProfile = parseApplicantDetails

export function parseApplicantIdentity(raw: unknown): ParsedApplicantIdentity {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "applicant must be an object" }
  }
  const o = raw as Record<string, unknown>
  if (typeof o.email !== "string" || !o.email.trim()) return { ok: false, error: "applicant.email is required" }
  const email = normaliseApplicantEmail(o.email)
  if (email.length > 320 || !EMAIL_RE.test(email)) return { ok: false, error: "applicant.email must be a valid email" }
  const rawName = typeof o.name === "string" ? o.name.trim() : ""
  const name = rawName.slice(0, 160)
  if (o.artist !== undefined && o.details !== undefined) return { ok: false, error: "Provide either community details or artist details, not both" }
  const key = o.artist !== undefined ? "artist" : "details"
  let details: ApplicantDetails | undefined
  if (o[key] !== undefined) {
    if (!rawName || rawName.length > 160) return { ok: false, error: "Name is required and must be 160 characters or fewer" }
    try { details = parseApplicantDetails(o[key]) } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Invalid applicant details" }
    }
  }
  return { ok: true, value: { email, ...(name ? { name } : {}), ...(details ? { [key]: details } : {}) } }
}

export function applicantIdentityPayload(identity: ApplicantIdentity | null | undefined): Record<string, unknown> {
  if (!identity) return {}
  return {
    applicant_email: identity.email,
    ...(identity.name ? { applicant_name: identity.name } : {}),
    ...((identity.artist || identity.details) ? { applicant_details: identity.artist ?? identity.details, application_audience: identity.artist ? "artist" : "community" } : {}),
  }
}

export function applicantIdentityFromRow(row: {
  applicant_email?: string | null
  applicant_name?: string | null
  applicant_details?: unknown
  application_audience?: string | null
}): ApplicantIdentity | null {
  if (!row.applicant_email) return null
  let details: ApplicantDetails | undefined
  if (row.applicant_details) {
    try { details = parseApplicantDetails(row.applicant_details) } catch { /* Invalid stored details are omitted. */ }
  }
  return {
    email: row.applicant_email,
    ...(row.applicant_name ? { name: row.applicant_name } : {}),
    ...(details ? (row.application_audience === "artist" ? { artist: details } : { details }) : {}),
  }
}
