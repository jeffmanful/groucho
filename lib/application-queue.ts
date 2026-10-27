import { supabase } from "@/lib/supabase"

/** Where an application sits in the client's review workflow. */
export const APPLICATION_QUEUES = [
  "ready_for_review",
  "awaiting_assessment",
  "in_progress",
  "approved",
  "declined",
  "abandoned",
] as const
export type ApplicationQueue = (typeof APPLICATION_QUEUES)[number]

export const APPLICATION_SORTS = ["suitability", "newest", "oldest", "longest_waiting"] as const
export type ApplicationSort = (typeof APPLICATION_SORTS)[number]

export type ApplicationQueueFilters = {
  queue: ApplicationQueue | "all"
  audience: "community" | "artist" | "all"
  recommendation: "recommend" | "human_review" | "decline" | "all"
  minScore: number | null
  maxScore: number | null
  from: string | null
  to: string | null
  search: string
  sort: ApplicationSort
  offset: number
  limit: number
}

export const MAX_PAGE_SIZE = 100
export const MAX_EXPORT_ROWS = 5000

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback
}

function score(value: string | null): number | null {
  if (value === null || value.trim() === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : null
}

function isoDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? null : value
}

/** Free-text search, stripped of characters that PostgREST filter syntax would interpret. */
export function cleanSearch(value: string | null): string {
  return (value ?? "").replace(/[%*,()\\:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 80)
}

export function parseApplicationQueueFilters(params: URLSearchParams): ApplicationQueueFilters {
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(params.get("limit") ?? "", 10) || 50))
  return {
    queue: oneOf(params.get("queue"), [...APPLICATION_QUEUES, "all"] as const, "ready_for_review"),
    audience: oneOf(params.get("audience"), ["community", "artist", "all"] as const, "all"),
    recommendation: oneOf(params.get("recommendation"), ["recommend", "human_review", "decline", "all"] as const, "all"),
    minScore: score(params.get("minScore")),
    maxScore: score(params.get("maxScore")),
    from: isoDate(params.get("from")),
    to: isoDate(params.get("to")),
    search: cleanSearch(params.get("q")),
    sort: oneOf(params.get("sort"), APPLICATION_SORTS, "suitability"),
    offset: Math.max(0, Number.parseInt(params.get("offset") ?? "", 10) || 0),
    limit,
  }
}

/**
 * Narrow the score range to a suitability band under the project's own thresholds. Explicit
 * minScore/maxScore still apply; the band only tightens them.
 */
export function withBand(
  filters: ApplicationQueueFilters,
  band: string | null,
  policy: { acceptanceThreshold: number; reviewThreshold: number },
): ApplicationQueueFilters {
  const below = (value: number) => Math.max(0, Math.round((value - 0.0001) * 10000) / 10000)
  const range = band === "recommended_acceptance" ? { min: policy.acceptanceThreshold, max: null }
    : band === "review" ? { min: policy.reviewThreshold, max: below(policy.acceptanceThreshold) }
      : band === "below_threshold" ? { min: null, max: below(policy.reviewThreshold) }
        : null
  if (!range) return filters
  return {
    ...filters,
    minScore: range.min === null ? filters.minScore : Math.max(range.min, filters.minScore ?? 0),
    maxScore: range.max === null ? filters.maxScore : Math.min(range.max, filters.maxScore ?? 1),
  }
}

/** The minimal query surface used here, so filters can be tested without a database. */
export type FilterableQuery<Q> = {
  eq(column: string, value: unknown): Q
  gte(column: string, value: unknown): Q
  lte(column: string, value: unknown): Q
  lt(column: string, value: unknown): Q
  or(filters: string): Q
}

/** Apply every filter except the queue, which the caller sets (lists) or varies (counts). */
export function applySharedFilters<Q extends FilterableQuery<Q>>(query: Q, filters: ApplicationQueueFilters): Q {
  let next = query
  if (filters.audience !== "all") next = next.eq("application_audience", filters.audience)
  if (filters.recommendation !== "all") next = next.eq("recommendation", filters.recommendation)
  if (filters.minScore !== null) next = next.gte("suitability_score", filters.minScore)
  if (filters.maxScore !== null) next = next.lte("suitability_score", filters.maxScore)
  if (filters.from) next = next.gte("created_at", `${filters.from}T00:00:00Z`)
  if (filters.to) {
    const end = new Date(`${filters.to}T00:00:00Z`)
    end.setUTCDate(end.getUTCDate() + 1)
    next = next.lt("created_at", end.toISOString())
  }
  if (filters.search) {
    const term = `*${filters.search}*`
    next = next.or(`applicant_email.ilike.${term},applicant_name.ilike.${term},session_id.ilike.${term}`)
  }
  return next
}

export const QUEUE_COLUMNS = [
  "id", "session_id", "status", "created_at", "updated_at", "applicant_email", "applicant_name",
  "applicant_details", "application_audience", "suitability_score", "decision", "decision_source",
  "reviewer_kind", "reviewer_email", "decision_reason", "decided_at", "recommendation", "confidence",
  "report_status", "conversation_model", "answer_count", "queue",
].join(", ")

export type QueueRow = {
  id: string
  session_id: string
  status: string
  created_at: string
  updated_at: string
  applicant_email: string | null
  applicant_name: string | null
  applicant_details: unknown
  application_audience: string | null
  suitability_score: number | null
  decision: "approved" | "declined" | null
  decision_source: "human" | "policy" | null
  reviewer_kind: string | null
  reviewer_email: string | null
  decision_reason: string | null
  decided_at: string | null
  recommendation: "recommend" | "human_review" | "decline" | null
  confidence: number | null
  report_status: string | null
  conversation_model: string | null
  answer_count: number
  queue: ApplicationQueue
}

function baseQuery(organisationId: string, projectId: string, head = false) {
  return supabase.from("application_review_queue")
    .select(head ? "id" : QUEUE_COLUMNS, head ? { count: "exact", head: true } : { count: "exact" })
    .eq("organisation_id", organisationId)
    .eq("project_id", projectId)
}

/** One page of applications plus the total matching the filters. */
export async function listApplications(input: {
  organisationId: string
  projectId: string
  filters: ApplicationQueueFilters
  limit?: number
}): Promise<{ rows: QueueRow[]; total: number }> {
  const { filters } = input
  let query = applySharedFilters(baseQuery(input.organisationId, input.projectId), filters)
  if (filters.queue !== "all") query = query.eq("queue", filters.queue)
  if (filters.sort === "suitability") {
    query = query.order("suitability_score", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false })
  } else if (filters.sort === "newest") {
    query = query.order("created_at", { ascending: false })
  } else if (filters.sort === "oldest") {
    query = query.order("created_at", { ascending: true })
  } else {
    query = query.order("updated_at", { ascending: true })
  }
  // A unique tiebreaker keeps paging (and the export's chunks) stable when timestamps tie.
  query = query.order("id", { ascending: true })
  const limit = input.limit ?? filters.limit
  const { data, error, count } = await query.range(filters.offset, filters.offset + limit - 1)
  if (error) throw error
  return { rows: (data ?? []) as unknown as QueueRow[], total: count ?? 0 }
}

/** Count per queue, applying every filter except the queue itself. */
export async function countApplicationsByQueue(input: {
  organisationId: string
  projectId: string
  filters: ApplicationQueueFilters
}): Promise<Record<ApplicationQueue | "all", number>> {
  const queues = [...APPLICATION_QUEUES, "all"] as const
  const results = await Promise.all(queues.map(async (queue) => {
    let query = applySharedFilters(baseQuery(input.organisationId, input.projectId, true), input.filters)
    if (queue !== "all") query = query.eq("queue", queue)
    const { count, error } = await query
    if (error) throw error
    return [queue, count ?? 0] as const
  }))
  return Object.fromEntries(results) as Record<ApplicationQueue | "all", number>
}

export type QueueMetrics = {
  awaitingReview: number
  oldestPendingSince: string | null
  decidedLast7Days: number
  medianHoursToDecision: number | null
}

/** Median of a list of numbers, or null when empty. */
export function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** Project-wide workload figures; they deliberately ignore list filters. */
export async function applicationQueueMetrics(input: {
  organisationId: string
  projectId: string
  now?: Date
}): Promise<QueueMetrics> {
  const now = input.now ?? new Date()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const [pending, oldest, decidedRecently, decided] = await Promise.all([
    supabase.from("application_review_queue").select("id", { count: "exact", head: true })
      .eq("organisation_id", input.organisationId).eq("project_id", input.projectId).eq("queue", "ready_for_review"),
    supabase.from("application_review_queue").select("updated_at")
      .eq("organisation_id", input.organisationId).eq("project_id", input.projectId).eq("queue", "ready_for_review")
      .order("updated_at", { ascending: true }).limit(1).maybeSingle(),
    supabase.from("application_review_queue").select("id", { count: "exact", head: true })
      .eq("organisation_id", input.organisationId).eq("project_id", input.projectId).gte("decided_at", weekAgo),
    supabase.from("application_review_queue").select("updated_at, decided_at")
      .eq("organisation_id", input.organisationId).eq("project_id", input.projectId)
      .not("decided_at", "is", null).order("decided_at", { ascending: false }).limit(200),
  ])
  for (const result of [pending, oldest, decidedRecently, decided]) if (result.error) throw result.error
  const hours = ((decided.data ?? []) as Array<{ updated_at: string; decided_at: string }>)
    .map((row) => (Date.parse(row.decided_at) - Date.parse(row.updated_at)) / 3_600_000)
    .filter((value) => Number.isFinite(value) && value >= 0)
  const middle = median(hours)
  return {
    awaitingReview: pending.count ?? 0,
    oldestPendingSince: (oldest.data as { updated_at?: string } | null)?.updated_at ?? null,
    decidedLast7Days: decidedRecently.count ?? 0,
    medianHoursToDecision: middle === null ? null : Math.round(middle * 10) / 10,
  }
}

/** The shape the dashboard renders. */
export function applicationFromRow(row: QueueRow) {
  const details = row.applicant_details && typeof row.applicant_details === "object" && !Array.isArray(row.applicant_details)
    ? row.applicant_details as Record<string, unknown>
    : null
  return {
    id: row.id,
    sessionKey: row.session_id,
    status: row.status,
    queue: row.queue,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    applicant: {
      name: row.applicant_name,
      email: row.applicant_email,
      audience: row.application_audience === "artist" ? "artist" as const : "community" as const,
      artistName: typeof details?.artistName === "string" ? details.artistName : null,
      city: typeof details?.city === "string" ? details.city : null,
      age: typeof details?.age === "number" ? details.age : null,
      socialLinks: Array.isArray(details?.socialLinks) ? details.socialLinks.filter((link): link is string => typeof link === "string") : [],
      musicLinks: Array.isArray(details?.musicLinks) ? details.musicLinks.filter((link): link is string => typeof link === "string") : [],
    },
    assessment: {
      suitabilityScore: row.suitability_score,
      recommendation: row.recommendation,
      confidence: row.confidence === null ? null : Number(row.confidence),
      reportStatus: row.report_status,
      conversationModel: row.conversation_model,
      answerCount: row.answer_count,
    },
    decision: row.decision ? {
      decision: row.decision,
      source: row.decision_source,
      reviewer: row.reviewer_email,
      reason: row.decision_reason,
      decidedAt: row.decided_at,
    } : null,
  }
}

export type ApplicationListItem = ReturnType<typeof applicationFromRow>

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value)
  // Neutralise spreadsheet formulas and quote every cell.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

export function applicationsCsv(rows: QueueRow[]): string {
  const header = [
    "application_id", "client_session_key", "queue", "submitted_at", "last_activity_at", "name", "email",
    "applicant_type", "artist_name", "city", "suitability_score", "recommendation", "confidence",
    "answers", "decision", "decision_source", "reviewer", "decision_reason", "decided_at",
  ]
  const lines = rows.map((row) => {
    const item = applicationFromRow(row)
    return [
      item.id, item.sessionKey, item.queue, item.createdAt, item.updatedAt, item.applicant.name,
      item.applicant.email, item.applicant.audience, item.applicant.artistName, item.applicant.city,
      item.assessment.suitabilityScore, item.assessment.recommendation, item.assessment.confidence,
      item.assessment.answerCount, item.decision?.decision, item.decision?.source, item.decision?.reviewer,
      item.decision?.reason, item.decision?.decidedAt,
    ].map(csvCell).join(",")
  })
  return [header.map(csvCell).join(","), ...lines].join("\n")
}
