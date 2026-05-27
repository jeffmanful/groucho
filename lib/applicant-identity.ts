export type ApplicantIdentity = {
  email: string
  name?: string
}

export type ParsedApplicantIdentity =
  | { ok: true; value: ApplicantIdentity | null }
  | { ok: false; error: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normaliseApplicantEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

export function parseApplicantIdentity(raw: unknown): ParsedApplicantIdentity {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "applicant must be an object" }
  }

  const o = raw as Record<string, unknown>
  const rawEmail = o.email
  if (typeof rawEmail !== "string" || !rawEmail.trim()) {
    return { ok: false, error: "applicant.email is required" }
  }

  const email = normaliseApplicantEmail(rawEmail)
  if (email.length > 320 || !EMAIL_RE.test(email)) {
    return { ok: false, error: "applicant.email must be a valid email" }
  }

  const rawName = o.name
  let name: string | undefined
  if (typeof rawName === "string") {
    const trimmed = rawName.trim()
    if (trimmed) name = trimmed.slice(0, 160)
  }

  return { ok: true, value: { email, ...(name ? { name } : {}) } }
}

export function applicantIdentityPayload(
  identity: ApplicantIdentity | null | undefined,
): Record<string, string> {
  if (!identity) return {}
  return {
    applicant_email: identity.email,
    ...(identity.name ? { applicant_name: identity.name } : {}),
  }
}

export function applicantIdentityFromRow(row: {
  applicant_email?: string | null
  applicant_name?: string | null
}): ApplicantIdentity | null {
  if (!row.applicant_email) return null
  return {
    email: row.applicant_email,
    ...(row.applicant_name ? { name: row.applicant_name } : {}),
  }
}
