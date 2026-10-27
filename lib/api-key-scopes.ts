// What an API key may do. Conversation keys sit behind a client's browser-facing proxy, so only
// an applications key can read every application and record decisions.
import { hashApiKeySecret } from "@/lib/api-keys"
import { supabase } from "@/lib/supabase"

export const API_KEY_SCOPES = ["conversations", "applications"] as const
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]

/** One kind per key: a key that reviews applications is never also the applicant-flow key. */
export function parseApiKeyScopes(value: unknown): ApiKeyScope[] | null {
  if (value === undefined || value === null) return ["conversations"]
  if (!Array.isArray(value) || value.length !== 1) return null
  const scope = value[0]
  return scope === "conversations" || scope === "applications" ? [scope] : null
}

export type ApplicationsKeyContext = {
  apiKeyId: string
  organisationId: string
  projectId: string
}

function parseBearer(authorization: string | null): string | null {
  if (!authorization) return null
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim())
  return match?.[1] ?? null
}

/** Resolves an applications-scoped key, or explains why the request can't use these endpoints. */
export async function resolveApplicationsKey(
  authorization: string | null,
): Promise<{ ok: true; context: ApplicationsKeyContext } | { ok: false; status: number; error: string }> {
  const token = parseBearer(authorization)
  if (!token) return { ok: false, status: 401, error: "An applications API key is required" }
  const { data, error } = await supabase
    .from("api_keys")
    .select("*")
    .eq("key_hash", hashApiKeySecret(token))
    .is("revoked_at", null)
    .maybeSingle()
  if (error) return { ok: false, status: 500, error: "Database error" }
  if (!data) return { ok: false, status: 401, error: "Invalid API key" }
  const scopes = Array.isArray(data.scopes) ? (data.scopes as string[]) : ["conversations"]
  if (!scopes.includes("applications")) {
    return {
      ok: false,
      status: 403,
      error: "This key can run conversations only. Create an applications key in Groucho to review applications.",
    }
  }
  void supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id).then(() => {})
  return {
    ok: true,
    context: { apiKeyId: data.id as string, organisationId: data.organisation_id as string, projectId: data.project_id as string },
  }
}
