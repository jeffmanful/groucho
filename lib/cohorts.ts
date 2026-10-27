// Rounds and cohorts: where approved people go next, and how they get there.
import { randomInt } from "crypto"
import { enqueueAllocationWebhooks, enqueueRunWebhook } from "@/lib/allocation-events"
import { ENTRY_COLUMNS, entryFromRow, fieldOptions, type EntryItem } from "@/lib/entry-review"
import { supabase } from "@/lib/supabase"
import { COHORT_EVENTS } from "@/lib/webhook-events"

export type Actor =
  | { kind: "platform"; email: string }
  | { kind: "member"; userId: string; email: string | null }
  | { kind: "api"; apiKeyId: string }

export type Round = { id: string; name: string; opens_at: string | null; closes_at: string | null }

export type Cohort = {
  id: string
  name: string
  grantsAccess: boolean
  capacity: number | null
  fillOrder: "none" | "score" | "date" | "draw" | "manual"
  lockedAt: string | null
  lockedBy: string | null
  drawnAt: string | null
  members: number
}

export type AllocationRun = {
  id: string
  kind: string
  sourceCohort: string | null
  targetCohort: string | null
  moved: number
  rule: Record<string, unknown>
  actor: string
  reason: string | null
  createdAt: string
}

export type Fail = { ok: false; status: number; error: string }

const RPC_STATUS: Record<string, number> = { GR400: 400, GR404: 404, GR409: 409, GR422: 422, GR423: 409 }

function rpcFailure(error: { code?: string; message?: string }, fallback: string): Fail {
  if (error.code && RPC_STATUS[error.code]) return { ok: false, status: RPC_STATUS[error.code], error: error.message ?? fallback }
  if (error.code === "PGRST202" || error.code === "42883" || error.code === "42P01" || error.code === "PGRST205") {
    return { ok: false, status: 409, error: "Cohorts need the latest database update." }
  }
  console.error(fallback, error)
  return { ok: false, status: 500, error: "Database error" }
}

function actorColumns(actor: Actor) {
  return {
    actor_kind: actor.kind,
    actor_user_id: actor.kind === "member" ? actor.userId : null,
    actor_email: actor.kind === "api" ? null : actor.email,
    api_key_id: actor.kind === "api" ? actor.apiKeyId : null,
  }
}

/** The project's current round, created the first time cohorts are used. */
export async function currentRound(organisationId: string, projectId: string): Promise<Round> {
  const { data, error } = await supabase
    .from("allocation_rounds")
    .select("id, name, opens_at, closes_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (data) return data as Round
  const { data: project } = await supabase.from("projects").select("name").eq("id", projectId).maybeSingle()
  const { data: created, error: insertError } = await supabase
    .from("allocation_rounds")
    .insert({ organisation_id: organisationId, project_id: projectId, name: (project?.name as string | undefined)?.slice(0, 120) || "First round" })
    .select("id, name, opens_at, closes_at")
    .single()
  if (insertError) throw insertError
  return created as Round
}

async function countRows(table: string, column: string, value: string): Promise<number> {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true }).eq(column, value)
  if (error) throw error
  return count ?? 0
}

async function pagedColumn(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>, column: string): Promise<string[]> {
  const out: string[] = []
  for (let offset = 0; offset < 100_000; offset += 1000) {
    const { data, error } = await build(offset, offset + 999)
    if (error) throw error
    const rows = (data ?? []) as Array<Record<string, string>>
    out.push(...rows.map((row) => row[column]))
    if (rows.length < 1000) break
  }
  return out
}

function toCohort(row: Record<string, unknown>, members: number): Cohort {
  return {
    id: row.id as string,
    name: row.name as string,
    grantsAccess: Boolean(row.grants_access),
    capacity: (row.capacity as number | null) ?? null,
    fillOrder: (row.fill_order as Cohort["fillOrder"]) ?? "none",
    lockedAt: (row.locked_at as string | null) ?? null,
    lockedBy: (row.locked_by_email as string | null) ?? null,
    drawnAt: (row.drawn_at as string | null) ?? null,
    members,
  }
}

export async function listCohorts(roundId: string): Promise<Cohort[]> {
  const { data, error } = await supabase
    .from("cohorts")
    .select("*")
    .eq("round_id", roundId)
    .is("archived_at", null)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
  if (error) throw error
  return Promise.all((data ?? []).map(async (row) => toCohort(row, await countRows("cohort_members", "cohort_id", row.id as string))))
}

/** Approved people in the project who aren't in a cohort this round. */
export async function unallocatedIds(organisationId: string, projectId: string, roundId: string): Promise<string[]> {
  const [approved, placed] = await Promise.all([
    pagedColumn((from, to) => supabase.from("application_review_queue").select("id")
      .eq("organisation_id", organisationId).eq("project_id", projectId).eq("queue", "approved")
      .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to), "id"),
    pagedColumn((from, to) => supabase.from("cohort_members").select("session_id").eq("round_id", roundId)
      .order("session_id", { ascending: true }).range(from, to), "session_id"),
  ])
  const inCohort = new Set(placed)
  return approved.filter((id) => !inCohort.has(id))
}

async function memberIds(cohortId: string): Promise<string[]> {
  return pagedColumn((from, to) => supabase.from("cohort_members").select("session_id").eq("cohort_id", cohortId)
    .order("position", { ascending: true, nullsFirst: false }).order("session_id", { ascending: true }).range(from, to), "session_id")
}

export async function roundHistory(roundId: string, limit = 20): Promise<AllocationRun[]> {
  const { data, error } = await supabase
    .from("allocation_runs")
    .select("*")
    .eq("round_id", roundId)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw error
  const ids = [...new Set((data ?? []).flatMap((run) => [run.source_cohort_id, run.target_cohort_id]).filter(Boolean) as string[])]
  const { data: cohorts } = ids.length ? await supabase.from("cohorts").select("id, name").in("id", ids) : { data: [] }
  const name = new Map((cohorts ?? []).map((c) => [c.id as string, c.name as string]))
  return (data ?? []).map((run) => ({
    id: run.id as string,
    kind: run.kind as string,
    sourceCohort: run.source_cohort_id ? name.get(run.source_cohort_id as string) ?? "a cohort" : null,
    targetCohort: run.target_cohort_id ? name.get(run.target_cohort_id as string) ?? "a cohort" : null,
    moved: (run.moved as number) ?? 0,
    rule: (run.rule as Record<string, unknown>) ?? {},
    actor: run.actor_kind === "api" ? "Your app" : ((run.actor_email as string | null) ?? "Someone"),
    reason: (run.reason as string | null) ?? null,
    createdAt: run.created_at as string,
  }))
}

export type CohortsOverview = {
  round: Round
  cohorts: Cohort[]
  unallocated: number
  scored: boolean
  fields: Record<string, string[]>
  history: AllocationRun[]
}

export async function cohortsOverview(organisationId: string, projectId: string): Promise<CohortsOverview> {
  const round = await currentRound(organisationId, projectId)
  const [cohorts, unallocated, history, scored, fields] = await Promise.all([
    listCohorts(round.id),
    unallocatedIds(organisationId, projectId, round.id),
    roundHistory(round.id),
    supabase.from("application_review_queue").select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId).eq("project_id", projectId).eq("queue", "approved").not("suitability_score", "is", null)
      .then(({ count }) => (count ?? 0) > 0),
    fieldOptions(organisationId, projectId),
  ])
  return { round, cohorts, unallocated: unallocated.length, scored, fields, history }
}

export async function createCohort(input: {
  organisationId: string
  projectId: string
  name: string
  grantsAccess: boolean
  capacity: number | null
}): Promise<{ ok: true; cohort: Cohort } | Fail> {
  const name = input.name.trim()
  if (!name || name.length > 120) return { ok: false, status: 400, error: "Give the cohort a name of up to 120 characters" }
  if (input.capacity !== null && (!Number.isInteger(input.capacity) || input.capacity < 1)) {
    return { ok: false, status: 400, error: "Capacity must be a whole number of 1 or more, or empty for unlimited" }
  }
  const round = await currentRound(input.organisationId, input.projectId)
  const { count } = await supabase.from("cohorts").select("id", { count: "exact", head: true }).eq("round_id", round.id)
  const { data, error } = await supabase
    .from("cohorts")
    .insert({
      organisation_id: input.organisationId,
      project_id: input.projectId,
      round_id: round.id,
      name,
      grants_access: input.grantsAccess,
      capacity: input.capacity,
      position: count ?? 0,
    })
    .select("*")
    .single()
  if (error?.code === "23505") return { ok: false, status: 409, error: "There's already a cohort with that name" }
  if (error) return rpcFailure(error, "create cohort:")
  return { ok: true, cohort: toCohort(data, 0) }
}

export async function updateCohort(input: {
  projectId: string
  cohortId: string
  name?: string
  capacity?: number | null
}): Promise<{ ok: true } | Fail> {
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name || name.length > 120) return { ok: false, status: 400, error: "Give the cohort a name of up to 120 characters" }
    patch.name = name
  }
  if (input.capacity !== undefined) {
    if (input.capacity !== null && (!Number.isInteger(input.capacity) || input.capacity < 1)) {
      return { ok: false, status: 400, error: "Capacity must be a whole number of 1 or more, or empty for unlimited" }
    }
    if (input.capacity !== null && (await countRows("cohort_members", "cohort_id", input.cohortId)) > input.capacity) {
      return { ok: false, status: 409, error: "More people are already in this cohort than that capacity" }
    }
    patch.capacity = input.capacity
  }
  const { error } = await supabase.from("cohorts").update(patch).eq("id", input.cohortId).eq("project_id", input.projectId)
  if (error?.code === "23505") return { ok: false, status: 409, error: "There's already a cohort with that name" }
  if (error) return rpcFailure(error, "update cohort:")
  return { ok: true }
}

export type FillMode = "everyone" | "filter" | "random" | "score" | "select"

export type FillRequest = {
  organisationId: string
  projectId: string
  /** "unallocated", a cohort id, or "any" (the people named in sessionIds, wherever they are). */
  source: string
  /** A cohort id, or null to take people out of every cohort. */
  target: string | null
  mode: FillMode
  field?: string | null
  values?: string[]
  count?: number | null
  sessionIds?: string[]
  reason?: string | null
}

type CandidateRow = { id: string; entry: { fields?: Record<string, string> } | null; suitability_score: number | null; created_at: string }

async function candidateRows(ids: string[]): Promise<CandidateRow[]> {
  const rows: CandidateRow[] = []
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await supabase.from("application_review_queue").select("id, entry, suitability_score, created_at").in("id", ids.slice(i, i + 500))
    if (error) throw error
    rows.push(...((data ?? []) as CandidateRow[]))
  }
  return rows
}

/** Fisher–Yates with the platform's cryptographic randomness. */
export function secureShuffle<T>(items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

async function sourceIds(request: FillRequest, roundId: string): Promise<string[]> {
  if (request.source === "any") return [...new Set(request.sessionIds ?? [])]
  if (request.source === "unallocated") return unallocatedIds(request.organisationId, request.projectId, roundId)
  return memberIds(request.source)
}

type QueueRow = Parameters<typeof entryFromRow>[0]

/** A page of the people in a fill's source, for picking by hand. Search covers name, email and session key. */
export async function sourcePage(
  request: FillRequest,
  options: { offset: number; limit: number; search: string },
): Promise<{ ok: true; entries: EntryItem[]; total: number }> {
  const round = await currentRound(request.organisationId, request.projectId)
  const ids = await sourceIds(request, round.id)
  const term = options.search.replace(/[^\p{L}\p{N}@.\-_ ]/gu, "").trim().slice(0, 80)
  const rowsFor = async (chunk: string[]) => {
    if (!chunk.length) return [] as QueueRow[]
    let query = supabase.from("application_review_queue").select(ENTRY_COLUMNS).in("id", chunk)
    if (term) query = query.or(`applicant_email.ilike.*${term}*,applicant_name.ilike.*${term}*,session_id.ilike.*${term}*`)
    const { data, error } = await query
    if (error) throw error
    const byId = new Map(((data ?? []) as unknown as QueueRow[]).map((row) => [row.id, row]))
    // Keep the source's order (oldest approval first, or cohort position).
    return chunk.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
  }
  if (!term) {
    const rows = await rowsFor(ids.slice(options.offset, options.offset + options.limit))
    return { ok: true, entries: rows.map(entryFromRow), total: ids.length }
  }
  const matched: QueueRow[] = []
  for (let i = 0; i < ids.length; i += 500) matched.push(...(await rowsFor(ids.slice(i, i + 500))))
  return { ok: true, entries: matched.slice(options.offset, options.offset + options.limit).map(entryFromRow), total: matched.length }
}

/** Who a fill would move, and the rule that describes it. */
export async function resolveFill(request: FillRequest, roundId: string): Promise<{ ok: true; ids: string[]; available: number; rule: Record<string, unknown> } | Fail> {
  const source = await sourceIds(request, roundId)
  const rule: Record<string, unknown> = { mode: request.mode, source: request.source }
  let ids = source
  if (request.mode === "select") {
    const wanted = new Set(request.sessionIds ?? [])
    ids = source.filter((id) => wanted.has(id))
    rule.selected = wanted.size
  } else if (request.mode !== "everyone") {
    let rows = await candidateRows(source)
    if (request.field && request.values?.length) {
      const values = new Set(request.values)
      rows = rows.filter((row) => values.has(String(row.entry?.fields?.[request.field!] ?? "")))
      rule.filter = { field: request.field, values: request.values }
    }
    if (request.mode === "filter") {
      if (!request.field || !request.values?.length) return { ok: false, status: 400, error: "Choose a field and at least one value" }
      ids = rows.map((row) => row.id)
    } else {
      const count = request.count ?? 0
      if (!Number.isInteger(count) || count < 1) return { ok: false, status: 400, error: "Say how many people to add" }
      if (request.mode === "random") {
        ids = secureShuffle(rows.map((row) => row.id)).slice(0, count)
        rule.method = "fisher-yates"
        rule.randomness = "node:crypto"
      } else {
        const scored = rows.filter((row) => row.suitability_score !== null)
        if (!scored.length) return { ok: false, status: 400, error: "No one here has a score. Scoring is off for this project." }
        ids = scored
          .sort((a, b) => Number(b.suitability_score) - Number(a.suitability_score) || a.created_at.localeCompare(b.created_at))
          .slice(0, count)
          .map((row) => row.id)
      }
      rule.count = count
    }
  }
  return { ok: true, ids, available: source.length, rule }
}

export async function previewFill(request: FillRequest): Promise<{ ok: true; count: number; available: number; sample: EntryItem[] } | Fail> {
  const round = await currentRound(request.organisationId, request.projectId)
  const resolved = await resolveFill(request, round.id)
  if (!resolved.ok) return resolved
  const sampleIds = resolved.ids.slice(0, 5)
  const { data } = sampleIds.length
    ? await supabase.from("application_review_queue").select(ENTRY_COLUMNS).in("id", sampleIds)
    : { data: [] }
  return {
    ok: true,
    count: resolved.ids.length,
    available: resolved.available,
    sample: ((data ?? []) as unknown as Parameters<typeof entryFromRow>[0][]).map(entryFromRow),
  }
}

export async function fillCohort(request: FillRequest & { actor: Actor }): Promise<{ ok: true; runId: string; moved: number } | Fail> {
  const round = await currentRound(request.organisationId, request.projectId)
  const resolved = await resolveFill(request, round.id)
  if (!resolved.ok) return resolved
  if (!resolved.ids.length) return { ok: false, status: 400, error: "No one matches" }
  const kind = request.target === null ? "remove" : request.actor.kind === "api" ? "api" : request.mode === "everyone" ? "everyone" : request.mode
  const { data, error } = await supabase.rpc("allocate_to_cohort", {
    p_round_id: round.id,
    p_session_ids: resolved.ids,
    p_target_cohort_id: request.target,
    p_kind: kind,
    p_rule: resolved.rule,
    p_source_cohort_id: request.source === "unallocated" || request.source === "any" ? null : request.source,
    p_reason: request.reason ?? null,
    ...Object.fromEntries(Object.entries(actorColumns(request.actor)).map(([k, v]) => [`p_${k}`, v])),
  })
  if (error) return rpcFailure(error, "allocate:")
  const row = (Array.isArray(data) ? data[0] : data) as { run_id: string; moved: number }
  await enqueueAllocationWebhooks({ runId: row.run_id, projectId: request.projectId })
  return { ok: true, runId: row.run_id, moved: row.moved }
}

export async function setLocked(input: { organisationId: string; projectId: string; cohortId: string; locked: boolean; actor: Actor }): Promise<{ ok: true } | Fail> {
  const { data: cohort } = await supabase.from("cohorts").select("id, round_id, locked_at").eq("id", input.cohortId).eq("project_id", input.projectId).maybeSingle()
  if (!cohort) return { ok: false, status: 404, error: "Not found" }
  if (Boolean(cohort.locked_at) === input.locked) return { ok: true }
  const email = input.actor.kind === "api" ? null : input.actor.email
  const { error } = await supabase
    .from("cohorts")
    .update(input.locked ? { locked_at: new Date().toISOString(), locked_by_email: email } : { locked_at: null, locked_by_email: null })
    .eq("id", input.cohortId)
  if (error) return rpcFailure(error, "lock cohort:")
  const { data: run } = await supabase
    .from("allocation_runs")
    .insert({
      organisation_id: input.organisationId,
      project_id: input.projectId,
      round_id: cohort.round_id,
      kind: input.locked ? "lock" : "unlock",
      target_cohort_id: input.cohortId,
      rule: { members: await countRows("cohort_members", "cohort_id", input.cohortId) },
      ...actorColumns(input.actor),
    })
    .select("id")
    .single()
  if (run && input.locked) await enqueueRunWebhook({ runId: run.id as string, projectId: input.projectId, event: COHORT_EVENTS.locked })
  return { ok: true }
}

export type DrawRequest = {
  organisationId: string
  projectId: string
  sourceId: string
  targetId: string
  restId: string | null
  /** One draw of this many, or with byField, a number per value. */
  count?: number
  byField?: string | null
  perValue?: Record<string, number>
  actor: Actor
}

/** Splits a shuffled pool into winners and the rest, per field value when asked. */
export function planDraw(
  pool: Array<{ id: string; value: string }>,
  request: { count?: number; byField?: string | null; perValue?: Record<string, number> },
  shuffle: <T>(items: readonly T[]) => T[] = secureShuffle,
): { ok: true; winners: string[]; rest: string[] } | Fail {
  if (!request.byField) {
    const count = request.count ?? 0
    if (!Number.isInteger(count) || count < 1) return { ok: false, status: 400, error: "Say how many winners to draw" }
    const order = shuffle(pool.map((item) => item.id))
    return { ok: true, winners: order.slice(0, count), rest: order.slice(count) }
  }
  const groups = new Map<string, string[]>()
  for (const item of pool) groups.set(item.value, [...(groups.get(item.value) ?? []), item.id])
  const winners: string[] = []
  const rest: string[] = []
  for (const value of [...groups.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const quota = request.perValue?.[value] ?? 0
    if (!Number.isInteger(quota) || quota < 0) return { ok: false, status: 400, error: `Winners for ${value} must be a whole number` }
    const order = shuffle(groups.get(value)!)
    winners.push(...order.slice(0, quota))
    rest.push(...order.slice(quota))
  }
  if (!winners.length) return { ok: false, status: 400, error: "Set how many winners to draw" }
  return { ok: true, winners, rest }
}

export async function drawCohort(request: DrawRequest): Promise<{ ok: true; runId: string; winners: number; rest: number } | Fail> {
  const ids = await memberIds(request.sourceId)
  if (!ids.length) return { ok: false, status: 400, error: "This cohort is empty" }
  const rows = request.byField ? await candidateRows(ids) : ids.map((id) => ({ id, entry: null, suitability_score: null, created_at: "" }))
  const pool = rows.map((row) => ({ id: row.id, value: request.byField ? String(row.entry?.fields?.[request.byField] ?? "Not given") : "" }))
  const plan = planDraw(pool, request)
  if (!plan.ok) return plan
  const { data, error } = await supabase.rpc("draw_cohort", {
    p_source_cohort_id: request.sourceId,
    p_target_cohort_id: request.targetId,
    p_winner_ids: plan.winners,
    p_rest_cohort_id: request.restId,
    p_rest_ids: request.restId ? plan.rest : [],
    p_rule: {
      method: "fisher-yates",
      randomness: "node:crypto",
      ...(request.byField ? { by: request.byField, per_value: request.perValue ?? {} } : { count: request.count }),
    },
    p_actor_kind: request.actor.kind,
    p_actor_user_id: request.actor.kind === "member" ? request.actor.userId : null,
    p_actor_email: request.actor.kind === "api" ? null : request.actor.email,
  })
  if (error) return rpcFailure(error, "draw:")
  const runId = data as string
  await enqueueAllocationWebhooks({ runId, projectId: request.projectId })
  await enqueueRunWebhook({ runId, projectId: request.projectId, event: COHORT_EVENTS.drawn })
  return { ok: true, runId, winners: plan.winners.length, rest: request.restId ? plan.rest.length : 0 }
}

/** How many members have each value of a drop field (for a draw by size). */
export async function cohortBreakdown(cohortId: string, field: string): Promise<Record<string, number>> {
  const rows = await candidateRows(await memberIds(cohortId))
  const counts: Record<string, number> = {}
  for (const row of rows) {
    const value = String(row.entry?.fields?.[field] ?? "Not given")
    counts[value] = (counts[value] ?? 0) + 1
  }
  return counts
}

/** Everyone in a cohort, in its order, for the cohort view and exports. */
export async function cohortMembers(cohortId: string, offset = 0, limit = 100): Promise<{ entries: Array<EntryItem & { position: number | null }>; total: number }> {
  const { data: members, error, count } = await supabase
    .from("cohort_members")
    .select("session_id, position", { count: "exact" })
    .eq("cohort_id", cohortId)
    .order("position", { ascending: true, nullsFirst: false })
    .order("added_at", { ascending: true })
    .range(offset, offset + limit - 1)
  if (error) throw error
  const ids = (members ?? []).map((m) => m.session_id as string)
  const { data: rows } = ids.length ? await supabase.from("application_review_queue").select(ENTRY_COLUMNS).in("id", ids) : { data: [] }
  const byId = new Map(((rows ?? []) as unknown as Parameters<typeof entryFromRow>[0][]).map((row) => [row.id, entryFromRow(row)]))
  return {
    entries: (members ?? []).flatMap((m) => {
      const entry = byId.get(m.session_id as string)
      return entry ? [{ ...entry, position: (m.position as number | null) ?? null }] : []
    }),
    total: count ?? ids.length,
  }
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value)
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

export async function cohortCsv(cohortId: string): Promise<string> {
  const all: Array<EntryItem & { position: number | null }> = []
  for (let offset = 0; offset < 100_000; offset += 500) {
    const page = await cohortMembers(cohortId, offset, 500)
    all.push(...page.entries)
    if (page.entries.length < 500) break
  }
  const fieldKeys = [...new Set(all.flatMap((entry) => Object.keys(entry.fields)))].sort()
  const header = ["position", "client_session_key", "name", "email", ...fieldKeys, "socials", "entered_at"]
  const lines = all.map((entry) =>
    [entry.position, entry.sessionKey, entry.name, entry.email, ...fieldKeys.map((key) => entry.fields[key]), entry.socials.join(" "), entry.createdAt]
      .map(csvCell)
      .join(","),
  )
  return [header.map(csvCell).join(","), ...lines].join("\n")
}

/** After a correction to declined: out of every cohort, recorded as a move. Never throws. */
export async function removeFromCohortsAfterDecline(input: { sessionId: string; actor: Actor; reason: string }): Promise<void> {
  try {
    const { data: members } = await supabase.from("cohort_members").select("round_id, cohort_id").eq("session_id", input.sessionId)
    for (const member of members ?? []) {
      const { data: round } = await supabase.from("allocation_rounds").select("organisation_id, project_id").eq("id", member.round_id as string).maybeSingle()
      if (!round) continue
      const { data: run } = await supabase
        .from("allocation_runs")
        .insert({
          organisation_id: round.organisation_id,
          project_id: round.project_id,
          round_id: member.round_id,
          kind: "remove",
          source_cohort_id: member.cohort_id,
          rule: { because: "decision corrected to declined" },
          moved: 1,
          reason: input.reason.slice(0, 1200),
          ...actorColumns(input.actor),
        })
        .select("id")
        .single()
      if (!run) continue
      await supabase.from("cohort_moves").insert({ run_id: run.id, round_id: member.round_id, session_id: input.sessionId, from_cohort_id: member.cohort_id, to_cohort_id: null })
      await supabase.from("cohort_members").delete().eq("round_id", member.round_id as string).eq("session_id", input.sessionId)
      await enqueueAllocationWebhooks({ runId: run.id as string, projectId: round.project_id as string })
    }
  } catch (error) {
    console.error("remove from cohorts after decline:", error)
  }
}
