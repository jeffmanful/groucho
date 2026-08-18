import type { AdminActor } from "@/lib/admin-actor"
import {
  fetchOrgRole,
  listAccessibleOrgIds,
  type OrgRole,
} from "@/lib/org-access"
import { parseProjectType } from "@/lib/project-settings"
import { supabase } from "@/lib/supabase"

export type OverviewProject = {
  id: string
  name: string
  slug: string
  organisationId: string
  projectType: "gatekeeper" | "onboarding"
  environment: "test" | "live" | null
  sessionMode: "live" | "dry-run" | null
  activeSessions: number
  lastSessionAt: string | null
}

export type OverviewOrganisation = {
  id: string
  name: string
  slug: string
  projectCount: number
  canCreateProject: boolean
  projects: OverviewProject[]
}

export type OverviewRecentSession = {
  id: string
  clientSessionKey: string
  status: string
  projectId: string
  projectName: string
  orgId: string
  orgName: string
  updatedAt: string
}

export type AdminOverviewPayload = {
  actor: {
    kind: "platform" | "member"
    email: string | null
    isPlatform: boolean
  }
  stats: {
    organisations: number
    projects: number
    activeSessions: number
    sessionsToday: number
    completedSessionsToday: number
  }
  organisations: OverviewOrganisation[]
  recentSessions: OverviewRecentSession[]
}

const COMPLETED_WITH_OUTCOME = new Set([
  "passed",
  "failed",
  "redirected",
  "rejected",
])

function settingsField(
  settings: unknown,
  key: string,
): string | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return null
  }
  const v = (settings as Record<string, unknown>)[key]
  return typeof v === "string" ? v : null
}

async function canCreateForOrg(
  actor: AdminActor,
  orgId: string,
): Promise<boolean> {
  if (actor.kind === "platform") return true
  const role = await fetchOrgRole(actor.userId, orgId)
  return role === "owner" || role === "admin"
}

export async function buildAdminOverview(
  actor: AdminActor,
): Promise<AdminOverviewPayload> {
  const orgIds = await listAccessibleOrgIds(actor)

  if (orgIds.length === 0) {
    return {
      actor: {
        kind: actor.kind,
        email: actor.email,
        isPlatform: actor.kind === "platform",
      },
      stats: {
        organisations: 0,
        projects: 0,
        activeSessions: 0,
        sessionsToday: 0,
        completedSessionsToday: 0,
      },
      organisations: [],
      recentSessions: [],
    }
  }

  const { data: orgRows, error: orgErr } = await supabase
    .from("organisations")
    .select("id, name, slug")
    .in("id", orgIds)
    .order("name", { ascending: true })

  if (orgErr) throw orgErr

  const { data: projectRows, error: projErr } = await supabase
    .from("projects")
    .select("id, name, slug, organisation_id, settings, created_at")
    .in("organisation_id", orgIds)
    .order("created_at", { ascending: true })

  if (projErr) throw projErr

  const projects = projectRows ?? []
  const projectIds = projects.map((p) => p.id)

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const todayIso = startOfToday.toISOString()

  type SessionAgg = {
    project_id: string
    status: string
    updated_at: string
    session_id: string
    id: string
  }

  let sessions: SessionAgg[] = []
  if (projectIds.length > 0) {
    const { data: sessionRows, error: sessErr } = await supabase
      .from("sessions")
      .select("id, session_id, project_id, status, updated_at, created_at")
      .in("project_id", projectIds)
      .order("updated_at", { ascending: false })
      .limit(500)

    if (sessErr) throw sessErr
    sessions = (sessionRows ?? []) as SessionAgg[]
  }

  const activeByProject = new Map<string, number>()
  const lastByProject = new Map<string, string>()
  let activeSessions = 0
  let sessionsToday = 0
  let completedSessionsToday = 0

  for (const s of sessions) {
    if (s.status === "active") {
      activeSessions++
      activeByProject.set(
        s.project_id,
        (activeByProject.get(s.project_id) ?? 0) + 1,
      )
    }
    const updated = s.updated_at
    const created = (s as { created_at?: string }).created_at ?? updated
    if (created >= todayIso || updated >= todayIso) {
      sessionsToday++
      if (COMPLETED_WITH_OUTCOME.has(s.status)) completedSessionsToday++
    }
    const prev = lastByProject.get(s.project_id)
    if (!prev || updated > prev) lastByProject.set(s.project_id, updated)
  }

  const orgById = new Map((orgRows ?? []).map((o) => [o.id, o]))
  const projectsByOrg = new Map<string, typeof projects>()
  for (const p of projects) {
    const list = projectsByOrg.get(p.organisation_id) ?? []
    list.push(p)
    projectsByOrg.set(p.organisation_id, list)
  }

  const organisations: OverviewOrganisation[] = []
  for (const orgId of orgIds) {
    const org = orgById.get(orgId)
    if (!org) continue
    const orgProjects = projectsByOrg.get(orgId) ?? []
    const canCreate = await canCreateForOrg(actor, orgId)

    organisations.push({
      id: org.id,
      name: org.name,
      slug: org.slug,
      projectCount: orgProjects.length,
      canCreateProject: canCreate,
      projects: orgProjects.map((p) => {
        const settings = p.settings
        const env = settingsField(settings, "environment")
        const mode = settingsField(settings, "session_mode")
        return {
          id: p.id,
          name: p.name,
          slug: p.slug,
          organisationId: p.organisation_id,
          projectType: parseProjectType(settings),
          environment: env === "live" ? "live" : env === "test" ? "test" : null,
          sessionMode:
            mode === "dry-run" ? "dry-run" : mode === "live" ? "live" : null,
          activeSessions: activeByProject.get(p.id) ?? 0,
          lastSessionAt: lastByProject.get(p.id) ?? null,
        }
      }),
    })
  }

  const projectMeta = new Map(
    projects.map((p) => [
      p.id,
      {
        name: p.name,
        orgId: p.organisation_id,
        orgName: orgById.get(p.organisation_id)?.name ?? "",
      },
    ]),
  )

  const recentSessions: OverviewRecentSession[] = sessions
    .slice(0, 10)
    .map((s) => {
      const meta = projectMeta.get(s.project_id)
      return {
        id: s.id,
        clientSessionKey: s.session_id,
        status: s.status,
        projectId: s.project_id,
        projectName: meta?.name ?? "",
        orgId: meta?.orgId ?? "",
        orgName: meta?.orgName ?? "",
        updatedAt: s.updated_at,
      }
    })

  return {
    actor: {
      kind: actor.kind,
      email: actor.email,
      isPlatform: actor.kind === "platform",
    },
    stats: {
      organisations: organisations.length,
      projects: projects.length,
      activeSessions,
      sessionsToday,
      completedSessionsToday,
    },
    organisations,
    recentSessions,
  }
}

export async function memberOrgRole(
  userId: string,
  orgId: string,
): Promise<OrgRole | null> {
  return fetchOrgRole(userId, orgId)
}
