import { NextResponse } from "next/server"

export const PRIVACY_HEADERS = { "Cache-Control": "no-store" }
export const ERASED_SESSION_CODE = "GR410"
export const ERASED_SESSION_MESSAGE = "This session is no longer available. Start a new session."

export function privacyJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVACY_HEADERS })
}

/** Cookie-authenticated destructive operations require an explicit same-origin request. */
export function privacyOriginDenied(req: Request): boolean {
  return req.headers.get("origin") !== new URL(req.url).origin
}

export function privacyDatabaseError(error: { code?: string }) {
  const status = ({ GR400: 400, GR404: 404, GR409: 409, GR423: 423 } as Record<string, number>)[error.code ?? ""]
  if (status) {
    const message = status === 423 ? "Session has an active privacy hold" : status === 404 ? "Not found" : "Invalid privacy operation"
    return privacyJson({ error: message }, status)
  }
  if (["PGRST202", "42P01", "42883"].includes(error.code ?? "")) {
    return privacyJson({ error: "Privacy controls require the latest database migration" }, 503)
  }
  // Do not expose SQL details, stored applicant data or database error payloads.
  return privacyJson({ error: "Privacy operation failed" }, 500)
}

export type RetentionPolicy = {
  enabled: boolean
  active_days: number
  abandoned_days: number
  completed_days: number
}

export function parseRetentionPolicy(value: unknown): RetentionPolicy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const body = value as Record<string, unknown>
  if (typeof body.enabled !== "boolean") return null
  for (const key of ["active_days", "abandoned_days", "completed_days"]) {
    if (typeof body[key] !== "number" || !Number.isInteger(body[key]) || body[key] < 1 || body[key] > 3650) return null
  }
  return { enabled: body.enabled, active_days: body.active_days as number, abandoned_days: body.abandoned_days as number, completed_days: body.completed_days as number }
}

export function validPrivacySessionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
