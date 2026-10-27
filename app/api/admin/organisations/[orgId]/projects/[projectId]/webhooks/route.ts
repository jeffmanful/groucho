import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requireOrgAdmin, requireOrgMember, unauthorized } from "@/lib/org-access"
import { supabase } from "@/lib/supabase"
import { generateWebhookSigningSecret } from "@/lib/verdict-webhook"
import { parseWebhookEvents, WEBHOOK_EVENTS } from "@/lib/webhook-events"

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
    .from("webhooks")
    .select("id, label, url, events, active, created_at, updated_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("webhooks list:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
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

  let body: { url?: string; label?: string | null; events?: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const url = body.url?.trim()
  if (!url || !url.startsWith("https://")) {
    return NextResponse.json(
      { error: "url is required and must start with https://" },
      { status: 400 },
    )
  }

  const label = body.label?.trim() || null
  const events = body.events === undefined ? ["session.completed"] : parseWebhookEvents(body.events)
  if (!events) {
    return NextResponse.json({ error: `events must list one or more of: ${WEBHOOK_EVENTS.join(", ")}` }, { status: 400 })
  }

  const signing_secret = generateWebhookSigningSecret()

  const { data, error } = await supabase
    .from("webhooks")
    .insert({
      organisation_id: orgId,
      project_id: projectId,
      url,
      label,
      events,
      signing_secret,
    })
    .select("id, label, url, events, active, created_at")
    .single()

  if (error) {
    console.error("webhooks insert:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  return NextResponse.json(
    {
      ...data,
      /** Shown once — store for your receiver’s HMAC verification. */
      signing_secret,
    },
    { status: 201 },
  )
}
