// What an organisation's dashboard pages show: its projects, review workload, personas and members.
import type { AdminActor } from "@/lib/admin-actor"
import { median } from "@/lib/application-queue"
import { fetchOrgRole, listAccessibleOrgIds } from "@/lib/org-access"
import { parseProjectType } from "@/lib/project-settings"
import { supabase } from "@/lib/supabase"

const DAY = 24 * 60 * 60 * 1000

export type ProjectSummary = {
  id: string
  name: string
  slug: string
  projectType: "gatekeeper" | "onboarding" | "ticket_access"
  environment: "live" | "test" | null
  archived: boolean
  personaId: string | null
  personaName: string | null
  conversations30d: number
  conversationsTotal: number
  activeNow: number
  /** Null when the review queue isn't available (its database view is missing). */
  toReview: number | null
  lastActivityAt: string | null
}

export type RecentDecision = {
  id: string
  projectId: string
  projectName: string
  applicant: string
  decision: "approved" | "declined"
  source: "human" | "policy" | null
  reviewer: string | null
  decidedAt: string
}

export type OrganisationSummary = {
  id: string
  name: string
  slug: string | null
  role: "platform" | "owner" | "admin" | "member" | null
  canManage: boolean
  memberCount: number
  projects: ProjectSummary[]
  personasInUse: Array<{ id: string; name: string; projects: string[] }>
  review: {
    available: boolean
    toReview: number
    decidedLast7Days: number
    medianHoursToDecision: number | null
    recentDecisions: RecentDecision[]
  }
}

function settingsOf(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

async function countSessions(projectId: string, extra?: { since?: string; status?: string }): Promise<number> {
  let query = supabase.from("sessions").select("id", { count: "exact", head: true }).eq("project_id", projectId)
  if (extra?.since) query = query.gte("created_at", extra.since)
  if (extra?.status) query = query.eq("status", extra.status)
  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

async function lastActivity(projectId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("sessions")
    .select("updated_at")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as { updated_at?: string } | null)?.updated_at ?? null
}

type ReviewFigures = {
  available: boolean
  toReviewByProject: Map<string, number>
  decidedLast7Days: number
  medianHoursToDecision: number | null
  recent: Array<Record<string, unknown>>
}

/** Review workload across an organisation, from the application review queue view. */
async function reviewFigures(organisationId: string, withDetail: boolean, now: Date): Promise<ReviewFigures> {
  const weekAgo = new Date(now.getTime() - 7 * DAY).toISOString()
  const pending = await supabase
    .from("application_review_queue")
    .select("project_id")
    .eq("organisation_id", organisationId)
    .eq("queue", "ready_for_review")
    .limit(5000)
  if (pending.error) {
    // The view ships in migration 20261026230000; without it the dashboard still works, minus review figures.
    return { available: false, toReviewByProject: new Map(), decidedLast7Days: 0, medianHoursToDecision: null, recent: [] }
  }
  const toReviewByProject = new Map<string, number>()
  for (const row of (pending.data ?? []) as Array<{ project_id: string }>) {
    toReviewByProject.set(row.project_id, (toReviewByProject.get(row.project_id) ?? 0) + 1)
  }
  if (!withDetail) return { available: true, toReviewByProject, decidedLast7Days: 0, medianHoursToDecision: null, recent: [] }

  const [decidedRecently, decided, recent] = await Promise.all([
    supabase.from("application_review_queue").select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId).gte("decided_at", weekAgo),
    supabase.from("application_review_queue").select("updated_at, decided_at, decision_source")
      .eq("organisation_id", organisationId).not("decided_at", "is", null)
      .order("decided_at", { ascending: false }).limit(200),
    supabase.from("application_review_queue")
      .select("id, project_id, applicant_name, applicant_email, decision, decision_source, reviewer_email, decided_at")
      .eq("organisation_id", organisationId).not("decided_at", "is", null)
      .order("decided_at", { ascending: false }).limit(6),
  ])
  for (const result of [decidedRecently, decided, recent]) if (result.error) throw result.error
  // Policy decisions are near-instant, so the median reflects people's review time only.
  const hours = ((decided.data ?? []) as Array<{ updated_at: string; decided_at: string; decision_source: string | null }>)
    .filter((row) => row.decision_source !== "policy")
    .map((row) => (Date.parse(row.decided_at) - Date.parse(row.updated_at)) / 3_600_000)
    .filter((value) => Number.isFinite(value) && value >= 0)
  const middle = median(hours)
  return {
    available: true,
    toReviewByProject,
    decidedLast7Days: decidedRecently.count ?? 0,
    medianHoursToDecision: middle === null ? null : Math.round(middle * 10) / 10,
    recent: (recent.data ?? []) as Array<Record<string, unknown>>,
  }
}

export async function buildOrganisationSummary(
  actor: AdminActor,
  organisationId: string,
  options: { detail: boolean; now?: Date } = { detail: true },
): Promise<OrganisationSummary | null> {
  const now = options.now ?? new Date()
  const monthAgo = new Date(now.getTime() - 30 * DAY).toISOString()
  const [{ data: organisation, error: orgError }, { data: projectRows, error: projectError }, members, role] = await Promise.all([
    supabase.from("organisations").select("id, name, slug").eq("id", organisationId).maybeSingle(),
    supabase.from("projects").select("id, name, slug, settings, created_at").eq("organisation_id", organisationId).order("created_at", { ascending: true }),
    supabase.from("organisation_members").select("user_id", { count: "exact", head: true }).eq("organisation_id", organisationId),
    actor.kind === "platform" ? Promise.resolve("platform" as const) : fetchOrgRole(actor.userId, organisationId),
  ])
  if (orgError) throw orgError
  if (projectError) throw projectError
  if (!organisation) return null

  const projects = (projectRows ?? []) as Array<{ id: string; name: string; slug: string; settings: unknown }>
  const personaIds = [...new Set(projects
    .map((project) => settingsOf(project.settings).persona_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0))]
  const [personaRows, review, counts] = await Promise.all([
    personaIds.length
      ? supabase.from("personas").select("id, name").in("id", personaIds).then(({ data, error }) => {
          if (error) throw error
          return (data ?? []) as Array<{ id: string; name: string }>
        })
      : Promise.resolve([] as Array<{ id: string; name: string }>),
    reviewFigures(organisationId, options.detail, now),
    Promise.all(projects.map(async (project) => {
      const [conversations30d, conversationsTotal, activeNow, lastActivityAt] = await Promise.all([
        countSessions(project.id, { since: monthAgo }),
        countSessions(project.id),
        countSessions(project.id, { status: "active" }),
        lastActivity(project.id),
      ])
      return { conversations30d, conversationsTotal, activeNow, lastActivityAt }
    })),
  ])
  const personaName = new Map(personaRows.map((row) => [row.id, row.name]))
  const projectName = new Map(projects.map((project) => [project.id, project.name]))

  const summaries: ProjectSummary[] = projects.map((project, index) => {
    const settings = settingsOf(project.settings)
    const environment = settings.environment
    const personaId = typeof settings.persona_id === "string" && settings.persona_id ? settings.persona_id : null
    return {
      id: project.id,
      name: project.name,
      slug: project.slug,
      projectType: parseProjectType(settings),
      environment: environment === "live" ? "live" : environment === "test" ? "test" : null,
      archived: settings.archived === true,
      personaId,
      personaName: personaId ? personaName.get(personaId) ?? null : null,
      ...counts[index],
      toReview: review.available ? review.toReviewByProject.get(project.id) ?? 0 : null,
    }
  })

  const personasInUse = new Map<string, { id: string; name: string; projects: string[] }>()
  for (const project of summaries) {
    if (!project.personaId || project.archived) continue
    const entry = personasInUse.get(project.personaId) ?? {
      id: project.personaId,
      name: project.personaName ?? "Unknown persona",
      projects: [],
    }
    entry.projects.push(project.name)
    personasInUse.set(project.personaId, entry)
  }

  return {
    id: organisation.id,
    name: organisation.name,
    slug: organisation.slug ?? null,
    role,
    canManage: role === "platform" || role === "owner" || role === "admin",
    memberCount: members.count ?? 0,
    projects: summaries,
    personasInUse: [...personasInUse.values()],
    review: {
      available: review.available,
      toReview: [...review.toReviewByProject.values()].reduce((sum, value) => sum + value, 0),
      decidedLast7Days: review.decidedLast7Days,
      medianHoursToDecision: review.medianHoursToDecision,
      recentDecisions: review.recent.map((row) => ({
        id: String(row.id),
        projectId: String(row.project_id),
        projectName: projectName.get(String(row.project_id)) ?? "",
        applicant: String(row.applicant_name || row.applicant_email || "Applicant"),
        decision: row.decision === "declined" ? "declined" : "approved",
        source: row.decision_source === "policy" ? "policy" : row.decision_source === "human" ? "human" : null,
        reviewer: typeof row.reviewer_email === "string" ? row.reviewer_email : null,
        decidedAt: String(row.decided_at),
      })),
    },
  }
}

/** Light summaries of every organisation the actor can open, for the organisations home. */
export async function buildOrganisationSummaries(actor: AdminActor): Promise<OrganisationSummary[]> {
  const ids = await listAccessibleOrgIds(actor)
  const summaries = await Promise.all(ids.map((id) => buildOrganisationSummary(actor, id, { detail: false })))
  return summaries
    .filter((summary): summary is OrganisationSummary => summary !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}
