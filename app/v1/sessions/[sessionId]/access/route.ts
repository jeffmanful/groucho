import { NextRequest } from "next/server"
import { log } from "@/lib/logger"
import { getOrCreateRequestId } from "@/lib/request-trace"
import { resolveProjectContext } from "@/lib/project-resolution"
import { checkRateLimit, readRateLimitConfig } from "@/lib/rate-limit"
import { supabase } from "@/lib/supabase"
import { tracedJson } from "@/lib/with-request-trace"

/**
 * POST /v1/sessions/{sessionId}/access — register email after a passed session.
 * Always returns 200 with `{ ok: true }` when the request is well-formed, to avoid
 * leaking whether the email already existed (OpenAPI note).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const requestId = getOrCreateRequestId(req)
  const projectResolved = await resolveProjectContext(req.headers.get("authorization"))
  if (!projectResolved.ok) {
    return tracedJson(req, projectResolved.body, {
      status: projectResolved.status,
    })
  }
  const { projectId, apiKeyId } = projectResolved.context

  const { sessionId: rawId } = await params
  const clientKey = decodeURIComponent(rawId).trim()

  let body: { email?: string; secret?: string }
  try {
    body = await req.json()
  } catch {
    return tracedJson(req, { error: "Invalid request" }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return tracedJson(req, { error: "Valid email is required" }, { status: 400 })
  }

  const rl = readRateLimitConfig()
  const bucket = checkRateLimit({
    namespace: "access",
    key: `${apiKeyId ?? "anon"}:${projectId}:${clientKey}`,
    limit: Math.max(3, Math.floor(rl.sessionPerMinute / 2)),
    windowMs: 60_000,
  })
  if (!bucket.ok) {
    return tracedJson(
      req,
      { error: "Rate limited" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(bucket.retryAfterMs / 1000)) },
      },
    )
  }

  const { data: session, error: sErr } = await supabase
    .from("sessions")
    .select("id, status, success_secret, applicant_email")
    .eq("session_id", clientKey)
    .eq("project_id", projectId)
    .maybeSingle()

  if (sErr) {
    log.error("v1_access_session_failed", {
      requestId,
      projectId,
      detail: sErr.message,
    })
    return tracedJson(req, { error: "Database error" }, { status: 500 })
  }

  if (!session) {
    return tracedJson(req, { ok: true })
  }

  if (session.status !== "passed") {
    return tracedJson(req, { error: "Session not eligible" }, { status: 403 })
  }

  if (session.success_secret && body.secret?.trim() !== session.success_secret) {
    return tracedJson(req, { error: "Invalid or missing secret" }, { status: 400 })
  }

  if (session.applicant_email && session.applicant_email !== email) {
    return tracedJson(
      req,
      { error: "Email does not match this application" },
      { status: 400 },
    )
  }

  if (!session.applicant_email) {
    await supabase
      .from("sessions")
      .update({ applicant_email: email })
      .eq("id", session.id)
  }

  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .upsert({ email }, { onConflict: "email" })
    .select("id")
    .single()

  if (pErr || !profile) {
    log.error("v1_access_profile_failed", {
      requestId,
      projectId,
      detail: pErr?.message,
    })
    return tracedJson(req, { ok: true })
  }

  const { error: eErr } = await supabase.from("profile_eligibility").insert({
    profile_id: profile.id,
    session_id: session.id,
  })

  if (eErr && eErr.code !== "23505") {
    log.error("v1_access_eligibility_failed", {
      requestId,
      projectId,
      detail: eErr.message,
    })
  }

  return tracedJson(req, { ok: true })
}
