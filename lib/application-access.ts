// Whether a secret grants access to an application. Without cohorts, an approval's secret does.
// Once a project uses cohorts, only a place in a cohort that grants access does, and only while
// the decision is still approved.
import { applicationDecisionGrantsAccess } from "@/lib/application-decision"
import { currentDecisionFor } from "@/lib/current-decision"
import { supabase } from "@/lib/supabase"

async function projectUsesCohorts(projectId: string): Promise<boolean> {
  const { count, error } = await supabase.from("cohorts").select("id", { count: "exact", head: true }).eq("project_id", projectId)
  // Before the cohorts migration there are no cohorts.
  if (error) return false
  return (count ?? 0) > 0
}

export async function applicationAccess(input: {
  sessionId: string
  projectId: string
  secret: string | null | undefined
}): Promise<{ granted: boolean; approved: boolean; error?: boolean }> {
  const { data: decision, error } = await currentDecisionFor<{ decision: string; access_secret: string | null }>(
    input.sessionId,
    "decision, access_secret",
  )
  if (error) return { granted: false, approved: false, error: true }
  const approved = decision?.decision === "approved"
  if (!approved) return { granted: false, approved: false }
  if (!(await projectUsesCohorts(input.projectId))) {
    return { granted: applicationDecisionGrantsAccess(decision, input.secret ?? undefined), approved }
  }
  const secret = input.secret?.trim()
  if (!secret) return { granted: false, approved }
  const { data: places } = await supabase.from("cohort_members").select("cohort_id, access_secret").eq("session_id", input.sessionId)
  const matching = (places ?? []).filter((place) => place.access_secret === secret).map((place) => place.cohort_id as string)
  if (!matching.length) return { granted: false, approved }
  const { data: cohorts } = await supabase.from("cohorts").select("id").in("id", matching).eq("grants_access", true).is("archived_at", null)
  return { granted: (cohorts ?? []).length > 0, approved }
}
