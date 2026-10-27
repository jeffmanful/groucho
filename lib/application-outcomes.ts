// What happened after a decision, reported by the client's system: invited, joined, active, left...
// Append-only; retries of the same report are ignored. Groucho uses these to measure whether the
// people it recommends actually join and take part.
import { currentDecisionFor } from "@/lib/current-decision"
import { APPLICATION_OUTCOMES, type ApplicationOutcome } from "@/lib/outcome-labels"
import { supabase } from "@/lib/supabase"

export { APPLICATION_OUTCOMES, OUTCOME_LABELS, type ApplicationOutcome } from "@/lib/outcome-labels"

export function parseApplicationOutcome(value: unknown): ApplicationOutcome | null {
  return typeof value === "string" && (APPLICATION_OUTCOMES as readonly string[]).includes(value)
    ? (value as ApplicationOutcome)
    : null
}

/** An ISO timestamp no more than five minutes in the future, or null when invalid. */
export function parseOccurredAt(value: unknown, now = new Date()): string | null {
  if (value === undefined || value === null || value === "") return now.toISOString()
  if (typeof value !== "string") return null
  const time = Date.parse(value)
  if (!Number.isFinite(time) || time > now.getTime() + 5 * 60_000) return null
  return new Date(time).toISOString()
}

export type OutcomeRecord = {
  id: string
  outcome: ApplicationOutcome
  occurred_at: string
  reported_at: string
  note: string | null
}

export type OutcomeResult =
  | { ok: true; outcome: OutcomeRecord | null; duplicate: boolean }
  | { ok: false; status: number; error: string }

export async function recordApplicationOutcome(input: {
  organisationId: string
  projectId: string
  /** Internal session id. */
  sessionId: string
  outcome: ApplicationOutcome
  occurredAt: string
  note?: string | null
  apiKeyId?: string | null
}): Promise<OutcomeResult> {
  const { data: decision, error: decisionError } = await currentDecisionFor<{ id: string }>(input.sessionId, "id")
  if (decisionError) return { ok: false, status: 500, error: "Database error" }
  if (!decision) return { ok: false, status: 409, error: "Report outcomes after the application is decided" }

  const { data, error } = await supabase
    .from("application_outcomes")
    .insert({
      organisation_id: input.organisationId,
      project_id: input.projectId,
      session_id: input.sessionId,
      decision_id: decision.id,
      outcome: input.outcome,
      occurred_at: input.occurredAt,
      note: input.note?.trim().slice(0, 500) || null,
      api_key_id: input.apiKeyId ?? null,
    })
    .select("id, outcome, occurred_at, reported_at, note")
    .single()
  if (error?.code === "23505") return { ok: true, outcome: null, duplicate: true }
  if (error?.code === "42P01" || error?.code === "PGRST205") {
    return { ok: false, status: 409, error: "Reported outcomes need the latest database update." }
  }
  if (error || !data) {
    console.error("application outcome insert:", error)
    return { ok: false, status: 500, error: "Database error" }
  }
  return { ok: true, outcome: data as OutcomeRecord, duplicate: false }
}

export type DecisionHistoryEntry = {
  id: string
  decision: "approved" | "declined"
  source: "human" | "policy"
  via: "dashboard" | "api" | "policy"
  reviewerEmail: string | null
  reviewerName: string | null
  reason: string | null
  applicantReason: string | null
  decidedAt: string
  correction: boolean
  current: boolean
}

/** Every decision for an application, oldest first, and the outcomes reported since. */
export async function applicationHistory(sessionId: string): Promise<{
  decisions: DecisionHistoryEntry[]
  outcomes: OutcomeRecord[]
}> {
  const [{ data: decisions, error }, outcomes] = await Promise.all([
    supabase.from("application_decisions").select("*").eq("session_id", sessionId).order("created_at", { ascending: true }),
    supabase
      .from("application_outcomes")
      .select("id, outcome, occurred_at, reported_at, note")
      .eq("session_id", sessionId)
      .order("occurred_at", { ascending: true }),
  ])
  if (error) throw error
  return {
    decisions: (decisions ?? []).map((row) => {
      const kind = row.reviewer_kind as string
      return {
        id: row.id as string,
        decision: row.decision === "approved" ? "approved" : "declined",
        source: row.decision_source === "policy" ? "policy" : "human",
        via: kind === "policy" ? "policy" : kind === "api" ? "api" : "dashboard",
        reviewerEmail: (row.reviewer_email as string | null) ?? null,
        reviewerName: (row.reviewer_name as string | null | undefined) ?? null,
        reason: (row.reason as string | null) ?? null,
        applicantReason: (row.applicant_reason as string | null | undefined) ?? null,
        decidedAt: row.created_at as string,
        correction: Boolean(row.supersedes_decision_id),
        current: !row.superseded_by,
      } satisfies DecisionHistoryEntry
    }),
    // Before the outcomes migration the table is missing; there is simply nothing reported yet.
    outcomes: outcomes.error ? [] : ((outcomes.data ?? []) as OutcomeRecord[]),
  }
}
