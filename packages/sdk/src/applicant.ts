/** The applicant's own connection, as seen by your server. Groucho uses it to spot entries that share a connection. */
export type ApplicantConnection = {
  /** The applicant's IP address, not your server's. */
  ip?: string | null
  /** The applicant's browser user agent. */
  userAgent?: string | null
  /** The applicant's Accept-Language header. */
  language?: string | null
}

/** Headers Groucho reads for the applicant's connection. Groucho trusts them only on requests with your API key. */
export const APPLICANT_HEADERS = {
  ip: "X-Groucho-Applicant-IP",
  userAgent: "X-Groucho-Applicant-User-Agent",
  language: "X-Groucho-Applicant-Language",
} as const

/** Sets the applicant headers on `headers`, replacing any existing ones. */
export function setApplicantHeaders(headers: Headers, applicant: ApplicantConnection | null | undefined): Headers {
  for (const name of Object.values(APPLICANT_HEADERS)) headers.delete(name)
  if (!applicant) return headers
  const values: Array<[string, string | null | undefined]> = [
    [APPLICANT_HEADERS.ip, applicant.ip],
    [APPLICANT_HEADERS.userAgent, applicant.userAgent],
    [APPLICANT_HEADERS.language, applicant.language],
  ]
  for (const [name, value] of values) {
    // Header values can't carry line breaks; keep them short.
    const text = value?.replace(/[\r\n]/g, " ").trim().slice(0, 400)
    if (text) headers.set(name, text)
  }
  return headers
}
