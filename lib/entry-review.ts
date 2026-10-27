// Reviewing entries in bulk: the list, flags for likely duplicates, and bulk decisions.
import { DECISION_EVENTS } from "@/lib/webhook-events"
import { enqueueDecisionWebhooksBulk } from "@/lib/allocation-events"
import { supabase } from "@/lib/supabase"

export const ENTRY_TABS = ["review", "flagged", "approved", "declined"] as const
export type EntryTab = (typeof ENTRY_TABS)[number]

export type EntryFilters = {
  tab: EntryTab
  noFlags: boolean
  field: string | null
  values: string[]
  conversation: "any" | "finished" | "none"
  search: string
  offset: number
  limit: number
}

export const ENTRY_COLUMNS = [
  "id", "project_id", "session_id", "status", "created_at", "updated_at", "applicant_email", "applicant_name",
  "applicant_details", "suitability_score", "decision", "decision_reason", "decided_at", "queue", "answer_count",
  "recommendation", "entry_kind", "entry", "email_matches", "phone_matches", "social_matches", "disposable_email", "flag_count",
].join(", ")

type EntryRow = {
  id: string
  project_id: string
  session_id: string
  status: string
  created_at: string
  applicant_email: string | null
  applicant_name: string | null
  applicant_details: unknown
  suitability_score: number | null
  decision: "approved" | "declined" | null
  decision_reason: string | null
  decided_at: string | null
  queue: string
  answer_count: number
  recommendation: string | null
  entry_kind: "conversation" | "form"
  entry: { phone?: string; socials?: string[]; fields?: Record<string, string> } | null
  email_matches: number
  phone_matches: number
  social_matches: number
  disposable_email: boolean
  flag_count: number
}

export type EntryFlag = { kind: "email" | "phone" | "social" | "disposable"; count: number }

export type EntryItem = {
  id: string
  sessionKey: string
  name: string | null
  email: string | null
  kind: "conversation" | "form"
  fields: Record<string, string>
  socials: string[]
  hasPhone: boolean
  conversation: { answers: number; finished: boolean }
  suitabilityScore: number | null
  queue: string
  decision: { decision: "approved" | "declined"; reason: string | null; decidedAt: string | null } | null
  flags: EntryFlag[]
  createdAt: string
  cohort?: { id: string; name: string } | null
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
/** Bulk actions apply to at most this many entries at once. */
export const BULK_LIMIT = 10_000

export function parseEntryFilters(params: URLSearchParams): EntryFilters {
  const tab = (ENTRY_TABS as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as EntryTab) : "review"
  const field = (params.get("field") ?? "").trim()
  const conversation = params.get("conversation")
  return {
    tab,
    noFlags: params.get("noFlags") === "1",
    field: /^[a-z][a-z0-9_]{0,39}$/i.test(field) ? field : null,
    values: params.getAll("value").map((value) => value.trim()).filter(Boolean).slice(0, 20),
    conversation: conversation === "finished" || conversation === "none" ? conversation : "any",
    search: (params.get("q") ?? "").replace(/[^\p{L}\p{N}@.\-_ ]/gu, "").trim().slice(0, 80),
    offset: Math.max(0, Number.parseInt(params.get("offset") ?? "", 10) || 0),
    limit: Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(params.get("limit") ?? "", 10) || DEFAULT_LIMIT)),
  }
}

type Filterable<Q> = {
  eq(column: string, value: unknown): Q
  gt(column: string, value: unknown): Q
  in(column: string, values: readonly unknown[]): Q
  or(filters: string): Q
}

/** Every filter, including the tab. */
export function applyEntryFilters<Q extends Filterable<Q>>(query: Q, filters: EntryFilters): Q {
  let next = query
  if (filters.tab === "review") next = next.in("queue", ["ready_for_review", "awaiting_assessment"])
  if (filters.tab === "flagged") next = next.in("queue", ["ready_for_review", "awaiting_assessment"]).gt("flag_count", 0)
  if (filters.tab === "approved") next = next.eq("queue", "approved")
  if (filters.tab === "declined") next = next.eq("queue", "declined")
  if (filters.noFlags) next = next.eq("flag_count", 0)
  if (filters.field && filters.values.length) {
    const column = `entry->fields->>${filters.field}`
    next = filters.values.length === 1 ? next.eq(column, filters.values[0]) : next.in(column, filters.values)
  }
  if (filters.conversation === "finished") next = next.gt("answer_count", 0)
  if (filters.conversation === "none") next = next.eq("answer_count", 0)
  if (filters.search) {
    const term = `*${filters.search}*`
    next = next.or(`applicant_email.ilike.${term},applicant_name.ilike.${term},session_id.ilike.${term}`)
  }
  return next
}

function socialsOf(row: EntryRow): string[] {
  const fromEntry = Array.isArray(row.entry?.socials) ? row.entry!.socials! : []
  const details = row.applicant_details as { socialLinks?: unknown } | null
  const fromDetails = Array.isArray(details?.socialLinks) ? (details!.socialLinks as unknown[]).filter((v): v is string => typeof v === "string") : []
  return [...new Set([...fromEntry, ...fromDetails])]
}

export function entryFromRow(row: EntryRow): EntryItem {
  const flags: EntryFlag[] = []
  if (row.email_matches > 1) flags.push({ kind: "email", count: row.email_matches })
  if (row.phone_matches > 1) flags.push({ kind: "phone", count: row.phone_matches })
  if (row.social_matches > 1) flags.push({ kind: "social", count: row.social_matches })
  if (row.disposable_email) flags.push({ kind: "disposable", count: 1 })
  return {
    id: row.id,
    sessionKey: row.session_id,
    name: row.applicant_name,
    email: row.applicant_email,
    kind: row.entry_kind,
    fields: row.entry?.fields && typeof row.entry.fields === "object" ? row.entry.fields : {},
    socials: socialsOf(row),
    hasPhone: Boolean(row.entry?.phone),
    conversation: { answers: row.answer_count ?? 0, finished: row.entry_kind === "conversation" && row.status !== "active" && row.status !== "abandoned" },
    suitabilityScore: row.suitability_score === null ? null : Number(row.suitability_score),
    queue: row.queue,
    decision: row.decision ? { decision: row.decision, reason: row.decision_reason, decidedAt: row.decided_at } : null,
    flags,
    createdAt: row.created_at,
  }
}

function base(organisationId: string, projectId: string, columns: string, head = false) {
  return supabase
    .from("application_review_queue")
    .select(columns, head ? { count: "exact", head: true } : { count: "exact" })
    .eq("organisation_id", organisationId)
    .eq("project_id", projectId)
    .neq("queue", "in_progress")
}

export type EntriesPage = {
  entries: EntryItem[]
  total: number
  stats: { entered: number; review: number; flagged: number; approved: number; declined: number }
  fields: Record<string, string[]>
}

export async function listEntries(organisationId: string, projectId: string, filters: EntryFilters): Promise<EntriesPage> {
  const page = await applyEntryFilters(base(organisationId, projectId, ENTRY_COLUMNS), filters)
    .order("created_at", { ascending: filters.tab === "review" || filters.tab === "flagged" })
    .order("id", { ascending: true })
    .range(filters.offset, filters.offset + filters.limit - 1)
  if (page.error) throw page.error
  const rows = (page.data ?? []) as unknown as EntryRow[]

  const counts = await Promise.all(
    (["review", "flagged", "approved", "declined"] as const).map(async (tab) => {
      const { count, error } = await applyEntryFilters(base(organisationId, projectId, "id", true), {
        ...filters, tab, noFlags: false,
      })
      if (error) throw error
      return count ?? 0
    }),
  )
  const { count: entered } = await base(organisationId, projectId, "id", true)

  // Cohort for approved entries on this page.
  const cohortBySession = new Map<string, { id: string; name: string }>()
  const approvedIds = rows.filter((row) => row.queue === "approved").map((row) => row.id)
  if (approvedIds.length) {
    const { data: members } = await supabase.from("cohort_members").select("session_id, cohort_id").in("session_id", approvedIds)
    const cohortIds = [...new Set((members ?? []).map((m) => m.cohort_id as string))]
    const { data: cohorts } = cohortIds.length
      ? await supabase.from("cohorts").select("id, name").in("id", cohortIds)
      : { data: [] }
    const names = new Map((cohorts ?? []).map((c) => [c.id as string, c.name as string]))
    for (const member of members ?? []) {
      cohortBySession.set(member.session_id as string, { id: member.cohort_id as string, name: names.get(member.cohort_id as string) ?? "Cohort" })
    }
  }

  return {
    entries: rows.map((row) => ({ ...entryFromRow(row), cohort: cohortBySession.get(row.id) ?? null })),
    total: page.count ?? rows.length,
    stats: { entered: entered ?? 0, review: counts[0], flagged: counts[1], approved: counts[2], declined: counts[3] },
    fields: await fieldOptions(organisationId, projectId),
  }
}

/** Drop fields seen in recent entries (for example size), with their values. */
export async function fieldOptions(organisationId: string, projectId: string): Promise<Record<string, string[]>> {
  const { data } = await supabase
    .from("sessions")
    .select("entry")
    .eq("organisation_id", organisationId)
    .eq("project_id", projectId)
    .not("entry", "is", null)
    .order("created_at", { ascending: false })
    .limit(1000)
  const options = new Map<string, Set<string>>()
  for (const row of data ?? []) {
    const fields = (row.entry as { fields?: Record<string, unknown> } | null)?.fields
    if (!fields || typeof fields !== "object") continue
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value !== "string" && typeof value !== "number") continue
      const set = options.get(key) ?? new Set<string>()
      if (set.size < 50) set.add(String(value))
      options.set(key, set)
    }
  }
  return Object.fromEntries(
    [...options.entries()].map(([key, values]) => [key, [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))]),
  )
}

/** Every id matching the filters, up to the bulk limit. PostgREST returns at most 1,000 rows per request. */
export async function matchingEntryIds(organisationId: string, projectId: string, filters: EntryFilters): Promise<{ ids: string[]; capped: boolean }> {
  const ids: string[] = []
  for (let offset = 0; offset < BULK_LIMIT; offset += 1000) {
    const { data, error } = await applyEntryFilters(base(organisationId, projectId, "id"), filters)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, Math.min(offset + 999, BULK_LIMIT - 1))
    if (error) throw error
    const page = (data ?? []) as unknown as Array<{ id: string }>
    ids.push(...page.map((row) => row.id))
    if (page.length < 1000) return { ids, capped: false }
  }
  return { ids, capped: true }
}

export type BulkReviewer =
  | { kind: "platform"; email: string }
  | { kind: "member"; userId: string; email: string | null }

/** Approve or decline many entries. Entries that already have a decision are left alone. */
export async function bulkDecide(input: {
  organisationId: string
  projectId: string
  sessionIds: string[]
  decision: "approved" | "declined"
  reason: string
  applicantReason?: string | null
  reviewer: BulkReviewer
}): Promise<{ ok: true; recorded: number; skipped: number } | { ok: false; status: number; error: string }> {
  const reason = input.reason.trim().slice(0, 1200)
  if (input.decision === "declined" && !reason) return { ok: false, status: 400, error: "A reason is required to decline" }
  const unique = [...new Set(input.sessionIds)].slice(0, BULK_LIMIT)
  const recorded: Array<{ id: string; session_id: string }> = []
  for (let i = 0; i < unique.length; i += 1000) {
    const { data, error } = await supabase.rpc("bulk_record_decisions", {
      p_project_id: input.projectId,
      p_session_ids: unique.slice(i, i + 1000),
      p_decision: input.decision,
      p_reason: reason || null,
      p_applicant_reason: input.applicantReason?.trim() || null,
      p_reviewer_kind: input.reviewer.kind,
      p_reviewer_user_id: input.reviewer.kind === "member" ? input.reviewer.userId : null,
      p_reviewer_email: input.reviewer.email,
    })
    if (error) {
      if (error.code === "GR400") return { ok: false, status: 400, error: error.message }
      if (error.code === "PGRST202" || error.code === "42883") return { ok: false, status: 409, error: "Bulk review needs the latest database update." }
      console.error("bulk decisions:", error)
      return { ok: false, status: 500, error: "Database error" }
    }
    recorded.push(...((data ?? []) as Array<{ id: string; session_id: string }>))
  }
  await enqueueDecisionWebhooksBulk({
    decisionIds: recorded.map((row) => row.id),
    projectId: input.projectId,
    event: DECISION_EVENTS.decided,
  })
  return { ok: true, recorded: recorded.length, skipped: unique.length - recorded.length }
}

export type MatchGroup = {
  token: string
  kind: "email" | "phone" | "social" | "disposable"
  label: string
  entries: EntryItem[]
}

function mask(kind: string, value: string): string {
  if (kind === "phone") return `••• ${value.slice(-3)}`
  if (kind === "email") {
    const [local, domain] = value.split("@")
    return `${local.slice(0, 2)}•••@${domain ?? ""}`
  }
  return value
}

/** The entries that share an identifier with this one, grouped by what matched. */
export async function entryMatches(organisationId: string, projectId: string, sessionId: string): Promise<MatchGroup[]> {
  const { data: own, error } = await supabase
    .from("entry_identifiers")
    .select("kind, value")
    .eq("session_id", sessionId)
    .eq("project_id", projectId)
  if (error) throw error
  const groups: MatchGroup[] = []
  for (const identifier of (own ?? []) as Array<{ kind: "email" | "phone" | "social"; value: string }>) {
    const { data: dismissed } = await supabase
      .from("entry_flag_dismissals")
      .select("kind")
      .eq("project_id", projectId)
      .eq("kind", identifier.kind)
      .eq("value", identifier.value)
      .maybeSingle()
    if (dismissed) continue
    const { data: others } = await supabase
      .from("entry_identifiers")
      .select("session_id")
      .eq("project_id", projectId)
      .eq("kind", identifier.kind)
      .eq("value", identifier.value)
      .limit(50)
    const ids = (others ?? []).map((row) => row.session_id as string)
    if (ids.length < 2) continue
    const { data: rows } = await supabase
      .from("application_review_queue")
      .select(ENTRY_COLUMNS)
      .eq("organisation_id", organisationId)
      .in("id", ids)
      .order("created_at", { ascending: true })
    groups.push({
      token: `${identifier.kind}:${identifier.value}`,
      kind: identifier.kind,
      label: `${identifier.kind === "email" ? "Same email" : identifier.kind === "phone" ? "Same phone number" : "Same social account"}: ${mask(identifier.kind, identifier.value)}`,
      entries: ((rows ?? []) as unknown as EntryRow[]).map(entryFromRow),
    })
  }
  const { data: self } = await supabase
    .from("application_review_queue")
    .select(ENTRY_COLUMNS)
    .eq("organisation_id", organisationId)
    .eq("id", sessionId)
    .maybeSingle()
  const row = self as unknown as EntryRow | null
  if (row?.disposable_email && row.applicant_email) {
    const domain = row.applicant_email.split("@")[1] ?? ""
    groups.push({ token: `disposable:${domain}`, kind: "disposable", label: `Disposable email provider: ${domain}`, entries: [entryFromRow(row)] })
  }
  return groups
}

/** "Not duplicates": the match stops flagging anyone in this project. */
export async function dismissMatch(input: { projectId: string; token: string; reason: string; email: string | null }) {
  const [kind, ...rest] = input.token.split(":")
  const value = rest.join(":")
  if (!["email", "phone", "social", "disposable"].includes(kind) || !value) return { ok: false as const, status: 400, error: "Unknown match" }
  const { error } = await supabase.from("entry_flag_dismissals").upsert({
    project_id: input.projectId,
    kind,
    value,
    dismissed_by_email: input.email,
    reason: input.reason.trim().slice(0, 1200) || null,
  })
  if (error) {
    console.error("dismiss match:", error)
    return { ok: false as const, status: 500, error: "Database error" }
  }
  return { ok: true as const }
}
