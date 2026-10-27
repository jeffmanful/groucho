// What a client's team has to look at now, across an organisation's projects.
import { applicationFromRow, withQueueColumns, type QueueRow } from "@/lib/application-queue"
import { supabase } from "@/lib/supabase"

export type NeedsYouApplication = {
  id: string
  projectId: string
  projectName: string
  name: string | null
  email: string | null
  audience: "community" | "artist"
  suitabilityScore: number | null
  recommendation: "recommend" | "human_review" | "decline" | null
  confidence: number | null
  waitingSince: string
}

export type NeedsYouDelivery = {
  id: string
  projectId: string
  projectName: string
  event: string
  url: string
  attempts: number
  httpStatus: number | null
  lastError: string | null
  createdAt: string
  /** Who the undelivered event was about. */
  applicant: { sessionId: string; name: string | null; email: string | null } | null
  decision: "approved" | "declined" | null
}

export type NeedsYou = {
  readyToDecide: NeedsYouApplication[]
  readyToDecideTotal: number
  awaitingAssessment: number
  failedDeliveries: NeedsYouDelivery[]
  total: number
}

const DAY = 86_400_000

export async function buildNeedsYou(organisationId: string, options: { limit?: number; now?: Date } = {}): Promise<NeedsYou> {
  const limit = options.limit ?? 8
  const now = options.now ?? new Date()
  const { data: projectRows, error: projectError } = await supabase
    .from("projects")
    .select("id, name, settings")
    .eq("organisation_id", organisationId)
  if (projectError) throw projectError
  const projects = ((projectRows ?? []) as Array<{ id: string; name: string; settings: unknown }>).filter(
    (project) => !(project.settings && typeof project.settings === "object" && (project.settings as Record<string, unknown>).archived === true),
  )
  const projectName = new Map(projects.map((project) => [project.id, project.name]))
  const projectIds = projects.map((project) => project.id)
  if (!projectIds.length) return { readyToDecide: [], readyToDecideTotal: 0, awaitingAssessment: 0, failedDeliveries: [], total: 0 }

  const [ready, awaiting, deliveries] = await Promise.all([
    withQueueColumns((columns) =>
      supabase
        .from("application_review_queue")
        .select(columns, { count: "exact" })
        .eq("organisation_id", organisationId)
        .in("project_id", projectIds)
        .eq("queue", "ready_for_review")
        .order("updated_at", { ascending: true })
        .limit(limit),
    ),
    supabase
      .from("application_review_queue")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .in("project_id", projectIds)
      .eq("queue", "awaiting_assessment"),
    failedDeliveries(projectIds, new Date(now.getTime() - 30 * DAY).toISOString()),
  ])
  if (ready.error) throw ready.error

  const readyToDecide = ((ready.data ?? []) as unknown as Array<QueueRow & { project_id: string }>).map((row) => {
    const item = applicationFromRow(row)
    return {
      id: row.id,
      projectId: row.project_id,
      projectName: projectName.get(row.project_id) ?? "Project",
      name: item.applicant.name,
      email: item.applicant.email,
      audience: item.applicant.audience,
      suitabilityScore: item.assessment.suitabilityScore === null ? null : Number(item.assessment.suitabilityScore),
      recommendation: item.assessment.recommendation,
      confidence: item.assessment.confidence,
      waitingSince: row.updated_at,
    } satisfies NeedsYouApplication
  })
  const failed = deliveries.map((delivery) => ({ ...delivery, projectName: projectName.get(delivery.projectId) ?? "Project" }))
  const readyTotal = ready.count ?? readyToDecide.length
  return {
    readyToDecide,
    readyToDecideTotal: readyTotal,
    awaitingAssessment: awaiting.count ?? 0,
    failedDeliveries: failed,
    total: readyTotal + failed.length,
  }
}

async function failedDeliveries(projectIds: string[], since: string): Promise<Array<Omit<NeedsYouDelivery, "projectName"> & { projectName?: string }>> {
  const { data: hooks, error: hookError } = await supabase.from("webhooks").select("id, url, project_id").in("project_id", projectIds)
  if (hookError) throw hookError
  const hookById = new Map(((hooks ?? []) as Array<{ id: string; url: string; project_id: string }>).map((hook) => [hook.id, hook]))
  if (!hookById.size) return []

  const query = (columns: string) =>
    supabase
      .from("webhook_deliveries")
      .select(columns)
      .in("webhook_id", [...hookById.keys()])
      .eq("status", "failed")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20)
  let result = await query("id, webhook_id, event, attempt_count, http_status, last_error, created_at, decision_id, verdict_id")
  if (result.error?.code === "42703") {
    // Before decision webhooks, every delivery is session.completed.
    result = await query("id, webhook_id, attempt_count, http_status, last_error, created_at, verdict_id")
  }
  if (result.error) throw result.error
  const rows = (result.data ?? []) as unknown as Array<{
    id: string
    webhook_id: string
    event?: string | null
    attempt_count: number
    http_status: number | null
    last_error: string | null
    created_at: string
    decision_id?: string | null
    verdict_id: string | null
  }>
  if (!rows.length) return []

  const decisionIds = rows.map((row) => row.decision_id).filter((id): id is string => Boolean(id))
  const verdictIds = rows.map((row) => row.verdict_id).filter((id): id is string => Boolean(id))
  const [decisions, verdicts] = await Promise.all([
    decisionIds.length
      ? supabase.from("application_decisions").select("id, session_id, decision").in("id", decisionIds).then((r) => (r.data ?? []) as Array<{ id: string; session_id: string; decision: string }>)
      : Promise.resolve([]),
    verdictIds.length
      ? supabase.from("verdicts").select("id, session_id").in("id", verdictIds).then((r) => (r.data ?? []) as Array<{ id: string; session_id: string }>)
      : Promise.resolve([]),
  ])
  const sessionIds = [...new Set([...decisions.map((d) => d.session_id), ...verdicts.map((v) => v.session_id)])]
  const { data: sessions } = sessionIds.length
    ? await supabase.from("sessions").select("id, applicant_name, applicant_email").in("id", sessionIds)
    : { data: [] }
  const sessionById = new Map(((sessions ?? []) as Array<{ id: string; applicant_name: string | null; applicant_email: string | null }>).map((s) => [s.id, s]))
  const decisionById = new Map(decisions.map((d) => [d.id, d]))
  const verdictById = new Map(verdicts.map((v) => [v.id, v]))

  return rows.map((row) => {
    const hook = hookById.get(row.webhook_id)!
    const decision = row.decision_id ? decisionById.get(row.decision_id) : undefined
    const sessionId = decision?.session_id ?? (row.verdict_id ? verdictById.get(row.verdict_id)?.session_id : undefined)
    const session = sessionId ? sessionById.get(sessionId) : undefined
    return {
      id: row.id,
      projectId: hook.project_id,
      event: row.event ?? "session.completed",
      url: hook.url,
      attempts: row.attempt_count,
      httpStatus: row.http_status,
      lastError: row.last_error,
      createdAt: row.created_at,
      applicant: sessionId ? { sessionId, name: session?.applicant_name ?? null, email: session?.applicant_email ?? null } : null,
      decision: decision ? (decision.decision === "approved" ? "approved" : "declined") : null,
    }
  })
}

/** Send a failed delivery once more, now. Returns its new state. */
export async function retryDelivery(organisationId: string, deliveryId: string): Promise<
  { ok: true; status: string; httpStatus: number | null; lastError: string | null } | { ok: false; status: number; error: string }
> {
  const { data: delivery } = await supabase
    .from("webhook_deliveries")
    .select("id, webhook_id, attempt_count, status")
    .eq("id", deliveryId)
    .maybeSingle()
  if (!delivery) return { ok: false, status: 404, error: "Not found" }
  const { data: hook } = await supabase
    .from("webhooks")
    .select("id, organisation_id")
    .eq("id", delivery.webhook_id as string)
    .maybeSingle()
  if (!hook || hook.organisation_id !== organisationId) return { ok: false, status: 404, error: "Not found" }
  if (delivery.status === "delivered") return { ok: false, status: 409, error: "Already delivered" }

  // One more attempt now; if it fails it goes back to failed straight away.
  const { error } = await supabase
    .from("webhook_deliveries")
    .update({ status: "pending", max_attempts: (delivery.attempt_count as number) + 1, next_retry_at: new Date().toISOString() })
    .eq("id", deliveryId)
  if (error) return { ok: false, status: 500, error: "Database error" }

  const { tryDeliverWebhook } = await import("@/lib/verdict-webhook")
  await tryDeliverWebhook(deliveryId)
  const { data: after } = await supabase
    .from("webhook_deliveries")
    .select("status, http_status, last_error")
    .eq("id", deliveryId)
    .maybeSingle()
  return {
    ok: true,
    status: (after?.status as string) ?? "pending",
    httpStatus: (after?.http_status as number | null) ?? null,
    lastError: (after?.last_error as string | null) ?? null,
  }
}
