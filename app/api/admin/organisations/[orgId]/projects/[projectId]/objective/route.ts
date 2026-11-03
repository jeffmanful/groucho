import { NextResponse } from "next/server"
import { projectRoute, serverError } from "@/lib/admin-project-route"
import { projectSettingsAuditActor } from "@/lib/project-settings-audit"
import { parseObjectiveUpdate, readProjectObjective, type ProjectReviewObjective } from "@/lib/project-review-objective"
import { invalidateProjectSettingsCache } from "@/lib/project-resolution"
import { supabase } from "@/lib/supabase"

/** A member may edit only the shared review brief; assessment and decision settings stay protected. */
export async function PATCH(req: Request, { params }: { params: Promise<{ orgId: string; projectId: string }> }) {
  const route = await projectRoute(params, "member")
  if (!route.ok) return route.response
  const update = parseObjectiveUpdate(await req.json().catch(() => null))
  if (!update.ok) return NextResponse.json({ error: update.error }, { status: 400 })
  const { orgId, projectId, actor } = route.value
  try {
    const project = await supabase.from("projects").select("settings").eq("id", projectId).eq("organisation_id", orgId).maybeSingle()
    if (project.error) throw project.error
    if (!project.data) return NextResponse.json({ error: "Project unavailable." }, { status: 404 })
    const previous = readProjectObjective(project.data.settings)
    if ((previous?.revision ?? null) !== update.revision) return NextResponse.json({ error: "Someone updated the objective. Check the latest version before saving your changes." }, { status: 409 })
    if (update.cohortId) {
      const round = await supabase.from("allocation_rounds").select("id").eq("organisation_id", orgId).eq("project_id", projectId)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle()
      if (round.error) throw round.error
      if (!round.data) return NextResponse.json({ error: "The selected cohort is no longer in the current round." }, { status: 400 })
      const cohort = await supabase.from("cohorts").select("id").eq("id", update.cohortId).eq("organisation_id", orgId)
        .eq("project_id", projectId).eq("round_id", round.data.id).is("archived_at", null).maybeSingle()
      if (cohort.error?.code === "22P02") return NextResponse.json({ error: "Select an active cohort in this project." }, { status: 400 })
      if (cohort.error) throw cohort.error
      if (!cohort.data) return NextResponse.json({ error: "Select an active cohort in this project's current round." }, { status: 400 })
    }
    const existingSettings = project.data.settings && typeof project.data.settings === "object" && !Array.isArray(project.data.settings)
      ? project.data.settings as Record<string, unknown> : {}
    const objective: ProjectReviewObjective = {
      text: update.text, cohortId: update.cohortId, revision: crypto.randomUUID(), updatedAt: new Date().toISOString(), updatedBy: actor.email,
    }
    const settings = { ...existingSettings, review_objective: objective }
    let query = supabase.from("projects").update({ settings }).eq("id", projectId).eq("organisation_id", orgId)
    // Compare the complete JSON snapshot so a concurrent objective or settings save cannot be lost.
    query = project.data.settings == null ? query.is("settings", null) : query.eq("settings", JSON.stringify(project.data.settings))
    const saved = await query.select("id").maybeSingle()
    if (saved.error) throw saved.error
    if (!saved.data) return NextResponse.json({ error: "This project changed while you were editing. Check the latest version before saving." }, { status: 409 })
    invalidateProjectSettingsCache(projectId)
    const audit = await supabase.from("project_settings_audit").insert({
      organisation_id: orgId, project_id: projectId, ...projectSettingsAuditActor(actor), source: "review_objective",
      changed_keys: ["review_objective"], previous_settings: existingSettings, new_settings: settings,
    })
    return NextResponse.json({ objective, ...(audit.error ? { warning: "Objective saved. Its history could not be recorded." } : {}) })
  } catch (error) { return serverError("project objective:", error) }
}
