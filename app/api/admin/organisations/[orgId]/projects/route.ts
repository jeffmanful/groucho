import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { normalizeAdminSlug } from "@/lib/admin-slug"
import { requireOrgAdmin, requireOrgMember, unauthorized } from "@/lib/org-access"
import { validateProjectSettings } from "@/lib/project-settings"
import { supabase } from "@/lib/supabase"

async function orgExists(orgId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("organisations")
    .select("id")
    .eq("id", orgId)
    .maybeSingle()
  return !error && !!data
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId } = await params
  const deny = await requireOrgMember(actor, orgId)
  if (deny) return deny

  if (!(await orgExists(orgId))) {
    return NextResponse.json({ error: "Organisation not found" }, { status: 404 })
  }

  const { data, error } = await supabase
    .from("projects")
    .select("id, name, slug, created_at, expose_to_anon_read, settings")
    .eq("organisation_id", orgId)
    .order("created_at", { ascending: true })

  if (error) {
    console.error("projects list:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId } = await params
  const deny = await requireOrgAdmin(actor, orgId)
  if (deny) return deny

  if (!(await orgExists(orgId))) {
    return NextResponse.json({ error: "Organisation not found" }, { status: 404 })
  }

  let body: { name: string; slug: string; settings?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const name = body.name?.trim()
  const slug = normalizeAdminSlug(body.slug ?? "")
  if (!name || name.length < 2 || name.length > 64) {
    return NextResponse.json(
      { error: "Name must be between 2 and 64 characters." },
      { status: 400 },
    )
  }
  if (!slug) {
    return NextResponse.json({ error: "A valid slug is required." }, { status: 400 })
  }

  let settings: Record<string, unknown> = {}
  if (body.settings !== undefined) {
    if (body.settings === null || typeof body.settings !== "object" || Array.isArray(body.settings)) {
      return NextResponse.json({ error: "settings must be a JSON object." }, { status: 400 })
    }
    const validated = validateProjectSettings(
      body.settings as Record<string, unknown>,
    )
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 })
    }
    settings = validated.settings
  }

  const { data, error } = await supabase
    .from("projects")
    .insert({
      organisation_id: orgId,
      name,
      slug,
      expose_to_anon_read: false,
      settings,
    })
    .select("id, name, slug, created_at, expose_to_anon_read, settings")
    .single()

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "A project with that slug already exists in this organisation." },
        { status: 409 },
      )
    }
    console.error("projects insert:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
