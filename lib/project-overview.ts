import { listCohorts, unallocatedIds, type Cohort } from "@/lib/cohorts"
import { readProjectObjective, type ProjectReviewObjective } from "@/lib/project-review-objective"
import { supabase } from "@/lib/supabase"

export type ProjectOverview = {
  objective: ProjectReviewObjective | null
  round: { id: string; name: string } | null
  cohorts: Cohort[]
  unallocated: number
  review: { ready: number; awaitingAssessment: number; oldestPendingSince: string | null }
  canEditObjective: boolean
}

/** Reading the landing page must not create a round or alter allocations. */
export async function buildProjectOverview(organisationId: string, projectId: string): Promise<ProjectOverview> {
  const [project, round, ready, awaiting, oldest] = await Promise.all([
    supabase.from("projects").select("settings").eq("id", projectId).eq("organisation_id", organisationId).single(),
    supabase.from("allocation_rounds").select("id, name").eq("organisation_id", organisationId).eq("project_id", projectId)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("application_review_queue").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).eq("project_id", projectId).eq("queue", "ready_for_review"),
    supabase.from("application_review_queue").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).eq("project_id", projectId).eq("queue", "awaiting_assessment"),
    supabase.from("application_review_queue").select("updated_at").eq("organisation_id", organisationId).eq("project_id", projectId).eq("queue", "ready_for_review")
      .order("updated_at", { ascending: true }).limit(1).maybeSingle(),
  ])
  for (const result of [project, round, ready, awaiting, oldest]) if (result.error) throw result.error
  const currentRound = round.data as { id: string; name: string } | null
  let cohorts: Cohort[] = []
  let unallocated: number
  if (currentRound) {
    const [currentCohorts, ids] = await Promise.all([listCohorts(currentRound.id), unallocatedIds(organisationId, projectId, currentRound.id)])
    cohorts = currentCohorts
    unallocated = ids.length
  } else {
    const approved = await supabase.from("application_review_queue").select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId).eq("project_id", projectId).eq("queue", "approved")
    if (approved.error) throw approved.error
    unallocated = approved.count ?? 0
  }
  return {
    objective: readProjectObjective(project.data?.settings),
    round: currentRound,
    cohorts,
    unallocated,
    review: { ready: ready.count ?? 0, awaitingAssessment: awaiting.count ?? 0, oldestPendingSince: oldest.data?.updated_at ?? null },
    canEditObjective: true,
  }
}
