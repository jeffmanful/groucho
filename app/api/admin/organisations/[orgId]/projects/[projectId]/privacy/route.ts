import { projectRoute } from "@/lib/admin-project-route"
import { parseRetentionPolicy, privacyDatabaseError, privacyJson, privacyOriginDenied } from "@/lib/session-privacy"
import { supabase } from "@/lib/supabase"

type Context = { params: Promise<{ orgId: string; projectId: string }> }

/** Policy and a bounded dry-run preview. No deletion is performed by GET. */
export async function GET(_req: Request, { params }: Context) {
  const access = await projectRoute(params, "admin")
  if (!access.ok) return access.response
  const { projectId } = access.value
  const [policy, preview] = await Promise.all([
    supabase.from("project_retention_policies").select("enabled, active_days, abandoned_days, completed_days, updated_at").eq("project_id", projectId).maybeSingle(),
    supabase.rpc("session_retention_candidates", { p_project_id: projectId, p_limit: 100, p_include_disabled: true }),
  ])
  if (policy.error || preview.error) return privacyDatabaseError((policy.error ?? preview.error)!)
  return privacyJson({ policy: policy.data ?? null, candidates: preview.data ?? [], previewLimit: 100 })
}

export async function PUT(req: Request, { params }: Context) {
  if (privacyOriginDenied(req)) return privacyJson({ error: "Same-origin request required" }, 403)
  const access = await projectRoute(params, "admin")
  if (!access.ok) return access.response
  const policy = parseRetentionPolicy(await req.json().catch(() => null))
  if (!policy) return privacyJson({ error: "Provide enabled and integer active_days, abandoned_days, completed_days between 1 and 3650" }, 400)
  const { error } = await supabase.from("project_retention_policies").upsert({
    project_id: access.value.projectId, ...policy, updated_at: new Date().toISOString(),
  }, { onConflict: "project_id" })
  if (error) return privacyDatabaseError(error)
  return privacyJson({ policy })
}
