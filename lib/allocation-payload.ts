// Bodies for application.allocated, cohort.locked and cohort.drawn, built when each is delivered.
import { supabase } from "@/lib/supabase"
import type { CohortEvent } from "@/lib/webhook-events"

type CohortRef = { id: string; name: string; grants_access: boolean } | null

async function cohortRef(id: string | null): Promise<CohortRef> {
  if (!id) return null
  const { data } = await supabase.from("cohorts").select("id, name, grants_access").eq("id", id).maybeSingle()
  return data ? { id: data.id as string, name: data.name as string, grants_access: Boolean(data.grants_access) } : null
}

export type AllocationPayload = {
  event: "application.allocated"
  id: string
  occurred_at: string
  project: { id: string; organisation_id: string }
  round: { id: string; name: string }
  session: { client_session_key: string; internal_id: string }
  applicant?: { email: string | null; name: string | null }
  /** Where they are now. null: removed from all cohorts. */
  cohort: CohortRef
  previous_cohort: CohortRef
  position: number | null
  /** Whether they have access now. Revoke access when false. */
  has_access: boolean
  /** Only when the cohort grants access and this is still where they are. */
  access_secret?: string
  run: { id: string; kind: string }
}

export async function buildAllocationPayload(moveId: string): Promise<AllocationPayload | null> {
  const { data: move } = await supabase.from("cohort_moves").select("*").eq("id", moveId).maybeSingle()
  if (!move) return null
  const [{ data: run }, { data: round }, { data: session }, cohort, previous] = await Promise.all([
    supabase.from("allocation_runs").select("id, kind, organisation_id, project_id").eq("id", move.run_id as string).maybeSingle(),
    supabase.from("allocation_rounds").select("id, name").eq("id", move.round_id as string).maybeSingle(),
    supabase.from("sessions").select("id, session_id, applicant_email, applicant_name").eq("id", move.session_id as string).maybeSingle(),
    cohortRef(move.to_cohort_id as string | null),
    cohortRef(move.from_cohort_id as string | null),
  ])
  if (!run || !round || !session) return null
  // The secret is only sent while this move is still current, so a retried old event can't re-grant access.
  const { data: member } = await supabase
    .from("cohort_members")
    .select("cohort_id, access_secret, run_id")
    .eq("round_id", move.round_id as string)
    .eq("session_id", move.session_id as string)
    .maybeSingle()
  const current = member && member.run_id === move.run_id && member.cohort_id === move.to_cohort_id
  return {
    event: "application.allocated",
    id: move.id as string,
    occurred_at: move.created_at as string,
    project: { id: run.project_id as string, organisation_id: run.organisation_id as string },
    round: { id: round.id as string, name: round.name as string },
    session: { client_session_key: session.session_id as string, internal_id: session.id as string },
    ...(session.applicant_email || session.applicant_name
      ? { applicant: { email: (session.applicant_email as string | null) ?? null, name: (session.applicant_name as string | null) ?? null } }
      : {}),
    cohort,
    previous_cohort: previous,
    position: (move.position as number | null) ?? null,
    has_access: Boolean(cohort?.grants_access),
    ...(current && cohort?.grants_access && member?.access_secret ? { access_secret: member.access_secret as string } : {}),
    run: { id: run.id as string, kind: run.kind as string },
  }
}

export type CohortRunPayload = {
  event: CohortEvent
  id: string
  occurred_at: string
  project: { id: string; organisation_id: string }
  round: { id: string; name: string }
  cohort: CohortRef
  /** For a draw: the cohort winners went to. */
  winners_cohort?: CohortRef
  rule: Record<string, unknown>
  moved: number
  by: { kind: string; email: string | null }
}

export async function buildCohortRunPayload(runId: string, event: CohortEvent): Promise<CohortRunPayload | null> {
  const { data: run } = await supabase.from("allocation_runs").select("*").eq("id", runId).maybeSingle()
  if (!run) return null
  const { data: round } = await supabase.from("allocation_rounds").select("id, name").eq("id", run.round_id as string).maybeSingle()
  if (!round) return null
  const isDraw = event === "cohort.drawn"
  return {
    event,
    id: run.id as string,
    occurred_at: run.created_at as string,
    project: { id: run.project_id as string, organisation_id: run.organisation_id as string },
    round: { id: round.id as string, name: round.name as string },
    cohort: await cohortRef((isDraw ? run.source_cohort_id : run.target_cohort_id) as string | null),
    ...(isDraw ? { winners_cohort: await cohortRef(run.target_cohort_id as string | null) } : {}),
    rule: (run.rule as Record<string, unknown>) ?? {},
    moved: (run.moved as number) ?? 0,
    by: { kind: run.actor_kind as string, email: (run.actor_email as string | null) ?? null },
  }
}
