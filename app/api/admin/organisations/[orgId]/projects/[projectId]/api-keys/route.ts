import { NextRequest, NextResponse } from "next/server"
import {
  apiKeyPrefix,
  generateGatekeeperApiKey,
  hashApiKeySecret,
} from "@/lib/api-keys"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requireOrgAdmin, requireOrgMember, unauthorized } from "@/lib/org-access"
import { parseApiKeyScopes } from "@/lib/api-key-scopes"
import { supabase } from "@/lib/supabase"

async function assertProjectInOrg(
  orgId: string,
  projectId: string,
): Promise<{ ok: true } | { ok: false; status: number }> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, organisation_id")
    .eq("id", projectId)
    .eq("organisation_id", orgId)
    .maybeSingle()

  if (error || !data) return { ok: false, status: 404 }
  return { ok: true }
}

export async function GET(
  _req: NextRequest,
  {
    params,
  }: { params: Promise<{ orgId: string; projectId: string }> },
) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, projectId } = await params
  const deny = await requireOrgMember(actor, orgId)
  if (deny) return deny

  const check = await assertProjectInOrg(orgId, projectId)
  if (!check.ok) {
    return NextResponse.json({ error: "Not found" }, { status: check.status })
  }

  const { data, error } = await supabase
    .from("api_keys")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("api_keys list:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  // Never return the key hash. Keys from before scopes existed can only run conversations.
  return NextResponse.json(
    (data ?? []).map((row) => ({
      id: row.id,
      key_prefix: row.key_prefix,
      label: row.label,
      last_used_at: row.last_used_at,
      created_at: row.created_at,
      revoked_at: row.revoked_at,
      scopes: Array.isArray(row.scopes) ? row.scopes : ["conversations"],
    })),
  )
}

export async function POST(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ orgId: string; projectId: string }> },
) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, projectId } = await params
  const deny = await requireOrgAdmin(actor, orgId)
  if (deny) return deny

  const check = await assertProjectInOrg(orgId, projectId)
  if (!check.ok) {
    return NextResponse.json({ error: "Not found" }, { status: check.status })
  }

  let body: { label?: string; scopes?: unknown }
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const label = body.label?.trim() || null
  const scopes = parseApiKeyScopes(body.scopes)
  if (!scopes) {
    return NextResponse.json(
      { error: "scopes must be [\"conversations\"] or [\"applications\"]" },
      { status: 400 },
    )
  }
  const plaintext = generateGatekeeperApiKey()
  const key_hash = hashApiKeySecret(plaintext)
  const key_prefix = apiKeyPrefix(plaintext)

  const { data, error } = await supabase
    .from("api_keys")
    .insert({
      organisation_id: orgId,
      project_id: projectId,
      key_hash,
      key_prefix,
      label,
      // Older databases have no scopes column; a conversations key is what every key was before.
      ...(scopes.includes("applications") ? { scopes } : {}),
    })
    .select("id, key_prefix, label, created_at")
    .single()

  if (error) {
    if (error.code === "PGRST204" || error.code === "42703") {
      return NextResponse.json({ error: "Applications keys need the latest database update." }, { status: 409 })
    }
    console.error("api_keys insert:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  return NextResponse.json(
    {
      ...data,
      scopes,
      /** Shown once; store server-side or hand to integrator — never logged again. */
      secret: plaintext,
    },
    { status: 201 },
  )
}
