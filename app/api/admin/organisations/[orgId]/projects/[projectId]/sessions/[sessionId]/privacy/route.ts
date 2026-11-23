import { projectRoute } from "@/lib/admin-project-route"
import { privacyDatabaseError, privacyJson, privacyOriginDenied, validPrivacySessionId } from "@/lib/session-privacy"
import { supabase } from "@/lib/supabase"

type Context = { params: Promise<{ orgId: string; projectId: string; sessionId: string }> }

export async function GET(_req: Request, { params }: Context) {
  const access = await projectRoute(params, "admin")
  if (!access.ok) return access.response
  const { sessionId } = await params
  if (!validPrivacySessionId(sessionId)) return privacyJson({ error: "Not found" }, 404)
  const { data: session, error } = await supabase.from("sessions").select("id")
    .eq("id", sessionId).eq("project_id", access.value.projectId).eq("organisation_id", access.value.orgId).maybeSingle()
  if (error) return privacyDatabaseError(error)
  if (!session) return privacyJson({ error: "Not found" }, 404)
  const hold = await supabase.from("session_privacy_holds").select("reason_code, expires_at").eq("session_id", sessionId).maybeSingle()
  if (hold.error) return privacyDatabaseError(hold.error)
  return privacyJson({ hold: hold.data ?? null })
}

export async function PATCH(req: Request, { params }: Context) {
  if (privacyOriginDenied(req)) return privacyJson({ error: "Same-origin request required" }, 403)
  const access = await projectRoute(params, "admin")
  if (!access.ok) return access.response
  const { sessionId } = await params
  const body = await req.json().catch(() => null)
  if (!validPrivacySessionId(sessionId) || body?.confirmSessionId !== sessionId || body?.releaseHold !== true) {
    return privacyJson({ error: "Provide releaseHold and a matching confirmSessionId" }, 400)
  }
  const { error } = await supabase.rpc("set_session_privacy_hold", {
    p_organisation_id: access.value.orgId, p_project_id: access.value.projectId,
    p_session_id: sessionId, p_reason_code: null, p_expires_at: null,
  })
  if (error) return privacyDatabaseError(error)
  return privacyJson({ hold: null })
}

/** Operator fulfilment of a verified request; never exposed through applicant relays. */
export async function DELETE(req: Request, { params }: Context) {
  if (privacyOriginDenied(req)) return privacyJson({ error: "Same-origin request required" }, 403)
  const access = await projectRoute(params, "admin")
  if (!access.ok) return access.response
  const { sessionId } = await params
  const body = await req.json().catch(() => null)
  if (!validPrivacySessionId(sessionId) || body?.confirmSessionId !== sessionId) {
    return privacyJson({ error: "confirmSessionId must match the internal session UUID" }, 400)
  }
  const { data, error } = await supabase.rpc("erase_project_session", {
    p_organisation_id: access.value.orgId,
    p_project_id: access.value.projectId,
    p_session_id: sessionId,
    p_reason_code: "requested",
  })
  if (error) return privacyDatabaseError(error)
  return privacyJson({ deletion: data })
}

/** A scoped, expiring hold protects both explicit deletion and automatic expiry. */
export async function PUT(req: Request, { params }: Context) {
  if (privacyOriginDenied(req)) return privacyJson({ error: "Same-origin request required" }, 403)
  const access = await projectRoute(params, "admin")
  if (!access.ok) return access.response
  const { sessionId } = await params
  const body = await req.json().catch(() => null)
  if (!validPrivacySessionId(sessionId) || !body || typeof body !== "object") return privacyJson({ error: "Invalid request" }, 400)
  const expires = typeof body.expiresAt === "string" ? Date.parse(body.expiresAt) : NaN
  if (!["legal_obligation", "legal_claim", "rights_request"].includes(body.reasonCode) ||
      !Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + 366 * 86400_000) {
    return privacyJson({ error: "Provide a reasonCode and a future expiresAt within 366 days" }, 400)
  }
  const { error } = await supabase.rpc("set_session_privacy_hold", {
    p_organisation_id: access.value.orgId, p_project_id: access.value.projectId,
    p_session_id: sessionId, p_reason_code: body.reasonCode, p_expires_at: new Date(expires).toISOString(),
  })
  if (error) return privacyDatabaseError(error)
  return privacyJson({ heldUntil: new Date(expires).toISOString() })
}
