// Queues decision webhooks (`application.decided`, `application.decision_corrected`) for every
// active webhook that wants the event.
import { log } from "@/lib/logger"
import { DECISION_EVENTS, type DecisionEvent } from "@/lib/webhook-events"
import { supabase } from "@/lib/supabase"
import { tryDeliverWebhook } from "@/lib/verdict-webhook"

export { DECISION_EVENT, DECISION_EVENTS, isDecisionEvent, type DecisionEvent } from "@/lib/webhook-events"

/** A webhook with no events listed receives every event, as before. */
export function webhookWantsEvent(events: string[] | null | undefined, event: string): boolean {
  return !events?.length || events.includes(event)
}

/** Never throws: a decision is recorded even if its webhooks can't be queued. */
export async function enqueueDecisionWebhooks(input: {
  decisionId: string
  projectId: string
  event?: DecisionEvent
}): Promise<number> {
  const event = input.event ?? DECISION_EVENTS.decided
  try {
    const { data: hooks, error } = await supabase
      .from("webhooks")
      .select("id, events")
      .eq("project_id", input.projectId)
      .eq("active", true)
    if (error) throw error
    const wanted = (hooks ?? []).filter((hook) => webhookWantsEvent(hook.events as string[] | null, event))
    const queued: string[] = []
    for (const hook of wanted) {
      const { data, error: insertError } = await supabase
        .from("webhook_deliveries")
        .insert({
          webhook_id: hook.id,
          decision_id: input.decisionId,
          event,
          next_retry_at: new Date().toISOString(),
          status: "pending",
        })
        .select("id")
        .single()
      if (insertError?.code === "23505") continue
      if (insertError) throw insertError
      if (data) queued.push(data.id as string)
    }
    for (const id of queued) void tryDeliverWebhook(id)
    return queued.length
  } catch (error) {
    log.error("decision_webhooks_enqueue_failed", {
      decisionId: input.decisionId,
      projectId: input.projectId,
      detail: error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error),
    })
    return 0
  }
}
