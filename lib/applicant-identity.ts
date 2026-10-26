export type ArtistApplicantProfile = {
  city: string
  age: number
  artistName?: string
  socialLinks: string[]
  musicLinks: string[]
}

export type ApplicantIdentity = {
  email: string
  name?: string
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

export function parseArtistApplicantProfile(raw: unknown): ArtistApplicantProfile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("applicant.artist must be an object")
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
  let artist: ArtistApplicantProfile | undefined
  if (o.artist !== undefined) {
    if (!rawName || rawName.length > 160) return { ok: false, error: "Name is required and must be 160 characters or fewer" }
    try { artist = parseArtistApplicantProfile(o.artist) } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Invalid artist details" }
    }
  }
  return { ok: true, value: { email, ...(name ? { name } : {}), ...(artist ? { artist } : {}) } }
}

export function applicantIdentityPayload(identity: ApplicantIdentity | null | undefined): Record<string, unknown> {
  if (!identity) return {}
  return {
    applicant_email: identity.email,
    ...(identity.name ? { applicant_name: identity.name } : {}),
    ...(identity.artist ? { applicant_artist_profile: identity.artist } : {}),
  }
}

export function applicantIdentityFromRow(row: {
  applicant_email?: string | null
  applicant_name?: string | null
  applicant_artist_profile?: unknown
}): ApplicantIdentity | null {
  if (!row.applicant_email) return null
  let artist: ArtistApplicantProfile | undefined
  if (row.applicant_artist_profile) {
    try { artist = parseArtistApplicantProfile(row.applicant_artist_profile) } catch { /* Legacy invalid details are not promoted to artist mode. */ }
  }
  return {
    email: row.applicant_email,
    ...(row.applicant_name ? { name: row.applicant_name } : {}),
    ...(artist ? { artist } : {}),
  }
}
