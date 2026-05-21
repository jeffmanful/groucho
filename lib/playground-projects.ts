import type { AdminActor } from "@/lib/admin-actor"
import { listAccessibleOrgIds } from "@/lib/org-access"
import {
  contextFromIds,
  type ProjectContext,
} from "@/lib/project-resolution"
import { parseFlowConfig, parseProjectType } from "@/lib/project-settings"
import { supabase } from "@/lib/supabase"

export type PlaygroundProjectOption = {
  id: string
  name: string
  slug: string
  organisationId: string
  organisationName: string
  projectType: "gatekeeper" | "onboarding"
  environment: "test" | "live" | null
  sessionMode: "live" | "dry-run" | null
  welcomeMessage: string | null
}

function settingsField(settings: unknown, key: string): string | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return null
  }
  const v = (settings as Record<string, unknown>)[key]
  return typeof v === "string" ? v : null
}

export async function listPlaygroundProjects(
  actor: AdminActor,
): Promise<PlaygroundProjectOption[]> {
  const orgIds = await listAccessibleOrgIds(actor)
  if (orgIds.length === 0) return []

  const { data: orgRows, error: orgErr } = await supabase
    .from("organisations")
    .select("id, name")
    .in("id", orgIds)

  if (orgErr) throw orgErr
  const orgNameById = new Map((orgRows ?? []).map((o) => [o.id, o.name]))

  const { data: projects, error: projErr } = await supabase
    .from("projects")
    .select("id, name, slug, organisation_id, settings")
    .in("organisation_id", orgIds)
    .order("created_at", { ascending: true })

  if (projErr) throw projErr

  return (projects ?? []).map((p) => {
    const env = settingsField(p.settings, "environment")
    const mode = settingsField(p.settings, "session_mode")
    const flow = parseFlowConfig(p.settings)
    const welcomeMessage = flow?.welcome_message?.trim() || null
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      organisationId: p.organisation_id,
      organisationName: orgNameById.get(p.organisation_id) ?? "",
      projectType: parseProjectType(p.settings),
      environment: env === "live" ? "live" : env === "test" ? "test" : null,
      sessionMode:
        mode === "dry-run" ? "dry-run" : mode === "live" ? "live" : null,
      welcomeMessage,
    }
  })
}

export async function resolvePlaygroundProjectContext(
  actor: AdminActor,
  projectId: string,
): Promise<
  | { ok: true; context: ProjectContext }
  | { ok: false; status: number; body: { error: string } }
> {
  const id = projectId.trim()
  if (!id) {
    return { ok: false, status: 400, body: { error: "Invalid project id" } }
  }

  const orgIds = await listAccessibleOrgIds(actor)
  if (orgIds.length === 0) {
    return { ok: false, status: 403, body: { error: "Forbidden" } }
  }

  const { data: project, error } = await supabase
    .from("projects")
    .select("id, organisation_id")
    .eq("id", id)
    .maybeSingle()

  if (error) {
    console.error("playground project lookup:", error)
    return { ok: false, status: 500, body: { error: "Database error" } }
  }
  if (!project) {
    return { ok: false, status: 404, body: { error: "Project not found" } }
  }

  if (actor.kind !== "platform" && !orgIds.includes(project.organisation_id)) {
    return { ok: false, status: 403, body: { error: "Forbidden" } }
  }

  return {
    ok: true,
    context: await contextFromIds(
      project.organisation_id,
      project.id,
      null,
    ),
  }
}
