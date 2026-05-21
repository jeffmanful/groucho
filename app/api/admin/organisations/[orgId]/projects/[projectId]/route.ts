import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { normalizeAdminSlug } from "@/lib/admin-slug"
import { requireOrgAdmin, requireOrgMember, unauthorized } from "@/lib/org-access"
import { validateProjectSettings } from "@/lib/project-settings"
import { supabase } from "@/lib/supabase"

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

  const { data, error } = await supabase
    .from("projects")
    .select("id, name, slug, created_at, expose_to_anon_read, settings, organisation_id")
    .eq("id", projectId)
    .eq("organisation_id", orgId)
    .maybeSingle()

  if (error) {
    console.error("project get:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json(data)
}

export async function PATCH(
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

  let body: {
    name?: string
    slug?: string
    expose_to_anon_read?: boolean
    settings?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { data: project, error: findErr } = await supabase
    .from("projects")
    .select("id, organisation_id, settings")
    .eq("id", projectId)
    .eq("organisation_id", orgId)
    .maybeSingle()

  if (findErr || !project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const existingSettings =
    project.settings &&
    typeof project.settings === "object" &&
    !Array.isArray(project.settings)
      ? (project.settings as Record<string, unknown>)
      : {}

  const updates: {
    name?: string
    slug?: string
    expose_to_anon_read?: boolean
    settings?: Record<string, unknown>
  } = {}

  if (body.name !== undefined) {
    const n = body.name.trim()
    if (!n) return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 })
    updates.name = n
  }
  if (body.slug !== undefined) {
    const s = normalizeAdminSlug(body.slug)
    if (!s) return NextResponse.json({ error: "Invalid slug." }, { status: 400 })
    updates.slug = s
  }
  if (body.expose_to_anon_read !== undefined) {
    updates.expose_to_anon_read = Boolean(body.expose_to_anon_read)
  }
  if (body.settings !== undefined) {
    if (body.settings === null || typeof body.settings !== "object" || Array.isArray(body.settings)) {
      return NextResponse.json({ error: "settings must be a JSON object." }, { status: 400 })
    }
    const merged = {
      ...existingSettings,
      ...(body.settings as Record<string, unknown>),
    }
    const validated = validateProjectSettings(merged)
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 })
    }
    updates.settings = validated.settings
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No updates provided." }, { status: 400 })
  }

  if (updates.expose_to_anon_read === true) {
    const { error: clearErr } = await supabase
      .from("projects")
      .update({ expose_to_anon_read: false })
      .eq("expose_to_anon_read", true)

    if (clearErr) {
      console.error("projects clear expose:", clearErr)
      return NextResponse.json({ error: "Database error" }, { status: 500 })
    }
  }

  const { data, error } = await supabase
    .from("projects")
    .update(updates)
    .eq("id", projectId)
    .eq("organisation_id", orgId)
    .select("id, name, slug, created_at, expose_to_anon_read, settings")
    .single()

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "A project with that slug already exists in this organisation." },
        { status: 409 },
      )
    }
    console.error("project patch:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function DELETE(
  _req: NextRequest,
  {
    params,
  }: { params: Promise<{ orgId: string; projectId: string }> },
) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, projectId } = await params
  const deny = await requireOrgAdmin(actor, orgId)
  if (deny) return deny

  const { data: project, error: findErr } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("organisation_id", orgId)
    .maybeSingle()

  if (findErr || !project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const { error } = await supabase.from("projects").delete().eq("id", projectId)

  if (error) {
    console.error("project delete:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
