// Webhooks for bulk work: many decisions at once, cohort moves, locks and draws. Deliveries are
// queued; small batches are sent straight away and large ones by the delivery worker, so a draw of
// thousands doesn't send thousands of requests from one request.
import { log } from "@/lib/logger"
import { supabase } from "@/lib/supabase"
import { tryDeliverWebhook } from "@/lib/verdict-webhook"
import { ALLOCATION_EVENT, type CohortEvent, type DecisionEvent } from "@/lib/webhook-events"

const SEND_NOW_LIMIT = 10

function wants(events: string[] | null | undefined, event: string): boolean {
  return !events?.length || events.includes(event)
}

async function hooksFor(projectId: string, event: string): Promise<string[]> {
  const { data, error } = await supabase.from("webhooks").select("id, events").eq("project_id", projectId).eq("active", true)
  if (error) throw error
  return (data ?? []).filter((hook) => wants(hook.events as string[] | null, event)).map((hook) => hook.id as string)
}

async function queue(rows: Array<Record<string, unknown>>): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await supabase
      .from("webhook_deliveries")
      .insert(rows.slice(i, i + 500))
      .select("id")
    if (error) throw error
    ids.push(...(data ?? []).map((row) => row.id as string))
  }
  if (ids.length <= SEND_NOW_LIMIT) for (const id of ids) void tryDeliverWebhook(id)
  return ids
}

function pending(): Record<string, unknown> {
  return { next_retry_at: new Date().toISOString(), status: "pending" }
}

/** Never throws. */
export async function enqueueDecisionWebhooksBulk(input: { decisionIds: string[]; projectId: string; event: DecisionEvent }): Promise<number> {
  if (!input.decisionIds.length) return 0
  try {
    const hooks = await hooksFor(input.projectId, input.event)
    const rows = hooks.flatMap((webhookId) => input.decisionIds.map((decisionId) => ({ webhook_id: webhookId, decision_id: decisionId, event: input.event, ...pending() })))
    return (await queue(rows)).length
  } catch (error) {
    log.error("bulk_decision_webhooks_failed", { projectId: input.projectId, detail: error instanceof Error ? error.message : String(error) })
    return 0
  }
}

/** One application.allocated per person moved in the run. Never throws. */
export async function enqueueAllocationWebhooks(input: { runId: string; projectId: string }): Promise<number> {
  try {
    const hooks = await hooksFor(input.projectId, ALLOCATION_EVENT)
    if (!hooks.length) return 0
    const moveIds: string[] = []
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.from("cohort_moves").select("id").eq("run_id", input.runId).order("created_at").range(offset, offset + 999)
      if (error) throw error
      moveIds.push(...(data ?? []).map((row) => row.id as string))
      if ((data ?? []).length < 1000) break
    }
    const rows = hooks.flatMap((webhookId) => moveIds.map((moveId) => ({ webhook_id: webhookId, move_id: moveId, event: ALLOCATION_EVENT, ...pending() })))
    return (await queue(rows)).length
  } catch (error) {
    log.error("allocation_webhooks_failed", { runId: input.runId, detail: error instanceof Error ? error.message : String(error) })
    return 0
  }
}

/** cohort.locked or cohort.drawn for a run. Never throws. */
export async function enqueueRunWebhook(input: { runId: string; projectId: string; event: CohortEvent }): Promise<number> {
  try {
    const hooks = await hooksFor(input.projectId, input.event)
    return (await queue(hooks.map((webhookId) => ({ webhook_id: webhookId, run_id: input.runId, event: input.event, ...pending() })))).length
  } catch (error) {
    log.error("cohort_webhooks_failed", { runId: input.runId, detail: error instanceof Error ? error.message : String(error) })
    return 0
  }
}
