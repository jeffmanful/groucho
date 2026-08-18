import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import {
  parseCulturalSignalsSettings,
  serializeCulturalSignalsSettings,
} from "@/lib/cultural-signal-contract"
import { getCulturalSignalSnapshot } from "@/lib/cultural-signals"
import { requireOrgAdmin, requireOrgMember, unauthorized } from "@/lib/org-access"
import { supabase } from "@/lib/supabase"

type Context = { params: Promise<{ orgId: string; projectId: string }> }

async function projectFor(orgId: string, projectId: string) {
  return supabase.from("projects").select("id, name, settings")
    .eq("id", projectId).eq("organisation_id", orgId).maybeSingle()
}

export async function GET(_request: NextRequest, { params }: Context) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, projectId } = await params
  const deny = await requireOrgMember(actor, orgId)
  if (deny) return deny
  const { data: project, error } = await projectFor(orgId, projectId)
  if (error) return NextResponse.json({ error: "Database error" }, { status: 500 })
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const config = parseCulturalSignalsSettings(project.settings)
  if (!config.enabled) return NextResponse.json({ project: { id: project.id, name: project.name }, config, snapshot: null })
  try {
    const snapshot = await getCulturalSignalSnapshot({ organisationId: orgId, projectId, settings: project.settings })
    return NextResponse.json({ project: { id: project.id, name: project.name }, config, snapshot })
  } catch (error) {
    console.error("cultural signals get:", error)
    return NextResponse.json({ error: "Could not build cultural signals" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, projectId } = await params
  const deny = await requireOrgAdmin(actor, orgId)
  if (deny) return deny
  const { data: project, error } = await projectFor(orgId, projectId)
  if (error) return NextResponse.json({ error: "Database error" }, { status: 500 })
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
  const root = project.settings && typeof project.settings === "object" && !Array.isArray(project.settings)
    ? project.settings as Record<string, unknown> : {}

  if (body.action === "set_enabled") {
    if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 })
    const settings = { ...root, cultural_signals: serializeCulturalSignalsSettings(body.enabled) }
    const { error: updateError } = await supabase.from("projects").update({ settings })
      .eq("id", projectId).eq("organisation_id", orgId)
    if (updateError) return NextResponse.json({ error: "Database error" }, { status: 500 })
    await supabase.from("cultural_signal_project_state").upsert({
      organisation_id: orgId, project_id: projectId, snapshot_dirty: true, updated_at: new Date().toISOString(),
    }, { onConflict: "project_id" })
    return NextResponse.json({ config: parseCulturalSignalsSettings(settings) })
  }

  if (body.action === "review_emerging") {
    if ((body.status !== "approved" && body.status !== "suppressed") || typeof body.normalizedKey !== "string") {
      return NextResponse.json({ error: "Invalid review" }, { status: 400 })
    }
    const normalizedKey = body.normalizedKey.trim()
    if (!/^[a-z0-9][a-z0-9_]{0,79}$/.test(normalizedKey)) {
      return NextResponse.json({ error: "Invalid signal key" }, { status: 400 })
    }
    const { data, error: reviewError } = await supabase.from("cultural_signal_definitions").update({
      status: body.status,
      reviewed_by: actor.kind === "member" ? actor.userId : null,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("organisation_id", orgId).eq("project_id", projectId)
      .eq("signal_type", "emerging_theme").eq("normalized_key", normalizedKey).select("id").maybeSingle()
    if (reviewError) return NextResponse.json({ error: "Database error" }, { status: 500 })
    if (!data) return NextResponse.json({ error: "Signal not found" }, { status: 404 })
  } else if (body.action !== "rebuild") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  }

  const config = parseCulturalSignalsSettings(root)
  if (!config.enabled) return NextResponse.json({ error: "Cultural signals are disabled" }, { status: 409 })
  try {
    const snapshot = await getCulturalSignalSnapshot({
      organisationId: orgId, projectId, settings: root, forceRebuild: true,
    })
    return NextResponse.json({ config, snapshot })
  } catch (error) {
    console.error("cultural signals rebuild:", error)
    return NextResponse.json({ error: "Could not rebuild cultural signals" }, { status: 500 })
  }
}
