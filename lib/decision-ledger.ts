// Everyone an organisation has decided on, newest first, with corrections and reported outcomes.
import { applicationFromRow, withQueueColumns, type QueueRow } from "@/lib/application-queue"
import { supabase } from "@/lib/supabase"

export const LEDGER_FILTERS = ["all", "approved", "declined", "corrected"] as const
export type LedgerFilter = (typeof LEDGER_FILTERS)[number]

/** Outcomes that mean the person joined at some point, even if they later left. */
export const JOINED_OUTCOMES = ["joined", "active", "inactive", "left", "removed"]

export type LedgerEntry = ReturnType<typeof applicationFromRow> & { projectId: string; projectName: string }

export type DecisionLedger = {
  entries: LedgerEntry[]
  total: number
  offset: number
  limit: number
  stats: {
    approved: number
    declined: number
    /** Null until the corrections and outcomes migration is applied. */
    corrected: number | null
    joined: number | null
    outcomesReported: number | null
  }
  projects: Array<{ id: string; name: string }>
}

function cleanSearch(value: string | null): string {
  return (value ?? "").replace(/[^\p{L}\p{N}@.\-_ ]/gu, "").trim().slice(0, 80)
}

export async function buildDecisionLedger(
  organisationId: string,
  params: URLSearchParams,
): Promise<DecisionLedger> {
  const filter = (LEDGER_FILTERS as readonly string[]).includes(params.get("filter") ?? "")
    ? (params.get("filter") as LedgerFilter)
    : "all"
  const search = cleanSearch(params.get("q"))
  const limit = Math.min(100, Math.max(1, Number.parseInt(params.get("limit") ?? "", 10) || 50))
  const offset = Math.max(0, Number.parseInt(params.get("offset") ?? "", 10) || 0)
  const projectFilter = params.get("project")

  const { data: projectRows, error: projectError } = await supabase
    .from("projects")
    .select("id, name")
    .eq("organisation_id", organisationId)
    .order("created_at", { ascending: true })
  if (projectError) throw projectError
  const projects = (projectRows ?? []) as Array<{ id: string; name: string }>
  const projectIds = projectFilter && projects.some((p) => p.id === projectFilter) ? [projectFilter] : projects.map((p) => p.id)
  const projectName = new Map(projects.map((project) => [project.id, project.name]))
  const empty = { entries: [], total: 0, offset, limit, stats: { approved: 0, declined: 0, corrected: 0, joined: 0, outcomesReported: 0 }, projects }
  if (!projectIds.length) return empty

  const scoped = <T,>(query: T) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (query as any).eq("organisation_id", organisationId).in("project_id", projectIds) as T
  const searched = <T,>(query: T) => {
    if (!search) return query
    const term = `*${search}*`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (query as any).or(`applicant_email.ilike.${term},applicant_name.ilike.${term},session_id.ilike.${term}`) as T
  }
  const count = async (apply: (query: ReturnType<typeof head>) => ReturnType<typeof head>) => {
    const { count: value, error } = await apply(head())
    if (error?.code === "42703") return null
    if (error) throw error
    return value ?? 0
  }
  const head = () => searched(scoped(supabase.from("application_review_queue").select("id", { count: "exact", head: true })))

  const [page, approved, declined, corrected, joined, outcomesReported] = await Promise.all([
    withQueueColumns((columns) => {
      let query = searched(scoped(supabase.from("application_review_queue").select(columns, { count: "exact" })))
      query = query.not("decision", "is", null)
      if (filter === "approved" || filter === "declined") query = query.eq("decision", filter)
      if (filter === "corrected") query = query.eq("decision_corrected", true)
      return query.order("decided_at", { ascending: false }).order("id", { ascending: true }).range(offset, offset + limit - 1)
    }),
    count((query) => query.eq("decision", "approved")),
    count((query) => query.eq("decision", "declined")),
    count((query) => query.eq("decision_corrected", true)),
    count((query) => query.eq("decision", "approved").in("latest_outcome", JOINED_OUTCOMES)),
    count((query) => query.eq("decision", "approved").not("latest_outcome", "is", null)),
  ])
  if (page.error?.code === "42703") {
    // The corrected filter needs the latest migration.
    return { ...empty, stats: { approved: approved ?? 0, declined: declined ?? 0, corrected: null, joined: null, outcomesReported: null } }
  }
  if (page.error) throw page.error

  const rows = (page.data ?? []) as unknown as Array<QueueRow & { project_id: string }>
  return {
    entries: rows.map((row) => ({
      ...applicationFromRow(row),
      projectId: row.project_id,
      projectName: projectName.get(row.project_id) ?? "Project",
    })),
    total: page.count ?? rows.length,
    offset,
    limit,
    stats: { approved: approved ?? 0, declined: declined ?? 0, corrected, joined, outcomesReported },
    projects,
  }
}
