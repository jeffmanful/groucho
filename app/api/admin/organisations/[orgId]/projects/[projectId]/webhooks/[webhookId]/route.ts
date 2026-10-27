import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requireOrgAdmin, requireOrgMember, unauthorized } from "@/lib/org-access"
import { supabase } from "@/lib/supabase"
import { generateWebhookSigningSecret } from "@/lib/verdict-webhook"
import { parseWebhookEvents, WEBHOOK_EVENTS } from "@/lib/webhook-events"

async function assertWebhookInProject(
  orgId: string,
  projectId: string,
  webhookId: string,
): Promise<{ ok: true } | { ok: false; status: number }> {
  const { data, error } = await supabase
    .from("webhooks")
    .select("id")
    .eq("id", webhookId)
    .eq("project_id", projectId)
    .eq("organisation_id", orgId)
    .maybeSingle()

  if (error || !data) return { ok: false, status: 404 }
  return { ok: true }
}

export async function GET(
  _req: NextRequest,
  {
    params,
  }: { params: Promise<{ orgId: string; projectId: string; webhookId: string }> },
) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, projectId, webhookId } = await params
  const deny = await requireOrgMember(actor, orgId)
  if (deny) return deny

  const check = await assertWebhookInProject(orgId, projectId, webhookId)
  if (!check.ok) {
    return NextResponse.json({ error: "Not found" }, { status: check.status })
  }

  const { data, error } = await supabase
    .from("webhooks")
    .select("id, label, url, events, active, created_at, updated_at")
    .eq("id", webhookId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json(data)
}

export async function PATCH(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ orgId: string; projectId: string; webhookId: string }> },
) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, projectId, webhookId } = await params
  const deny = await requireOrgAdmin(actor, orgId)
  if (deny) return deny

  const check = await assertWebhookInProject(orgId, projectId, webhookId)
  if (!check.ok) {
    return NextResponse.json({ error: "Not found" }, { status: check.status })
  }

  let body: {
    label?: string | null
    url?: string
    events?: string[]
    active?: boolean
    rotate_secret?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (body.label !== undefined) patch.label = body.label?.trim() || null
  if (body.url !== undefined) {
    const u = body.url.trim()
    if (!u.startsWith("https://")) {
      return NextResponse.json(
        { error: "url must start with https://" },
        { status: 400 },
      )
    }
    patch.url = u
  }
  if (body.events !== undefined) {
    const events = parseWebhookEvents(body.events)
    if (!events) {
      return NextResponse.json({ error: `events must list one or more of: ${WEBHOOK_EVENTS.join(", ")}` }, { status: 400 })
    }
    patch.events = events
  }
  if (body.active !== undefined) patch.active = body.active

  let newSecret: string | undefined
  if (body.rotate_secret) {
    newSecret = generateWebhookSigningSecret()
    patch.signing_secret = newSecret
  }

  const { data, error } = await supabase
    .from("webhooks")
    .update(patch)
    .eq("id", webhookId)
    .select("id, label, url, events, active, created_at, updated_at")
    .single()

  if (error) {
    console.error("webhooks patch:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  return NextResponse.json(
    newSecret ? { ...data, signing_secret: newSecret } : data,
  )
}

export async function DELETE(
  _req: NextRequest,
  {
    params,
  }: { params: Promise<{ orgId: string; projectId: string; webhookId: string }> },
) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, projectId, webhookId } = await params
  const deny = await requireOrgAdmin(actor, orgId)
  if (deny) return deny

  const check = await assertWebhookInProject(orgId, projectId, webhookId)
  if (!check.ok) {
    return NextResponse.json({ error: "Not found" }, { status: check.status })
  }

  const { error } = await supabase.from("webhooks").delete().eq("id", webhookId)

  if (error) {
    console.error("webhooks delete:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
