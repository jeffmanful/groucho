import { NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requireOrgMember, unauthorized } from "@/lib/org-access"
import { loadPersona, personaUsableByOrganisation } from "@/lib/persona-ownership"
import { colorsDemoProject } from "@/lib/colors-demo-access"
import { normalizeProjectSettings } from "@/lib/project-settings"
import { supabase } from "@/lib/supabase"

export async function resolvePersonaPreview(orgId: string, personaId: string) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const deny = await requireOrgMember(actor, orgId)
  if (deny) return deny
  const project = await colorsDemoProject()
  if (!project || project.context.organisationId !== orgId) {
    return NextResponse.json({ error: "COLORS preview is unavailable for this organisation." }, { status: 404 })
  }
  const persona = await loadPersona(personaId)
  if (!persona || !(await personaUsableByOrganisation(personaId, orgId))) {
    return NextResponse.json({ error: "Persona not found." }, { status: 404 })
  }
  if (!persona.is_active || !persona.prompt.trim()) {
    return NextResponse.json({ error: "Save an active persona with a prompt before trying it." }, { status: 409 })
  }
  const context = {
    ...project.context,
    settings: normalizeProjectSettings({
      ...project.context.settings.raw,
      persona_id: persona.id,
      conversation_engine: "colors_forum",
      application_invitation_required: false,
    }),
  }
  return {
    context,
    option: project.option,
    snapshot: {
      actor: actor.kind === "platform" ? `platform:${actor.email}` : `member:${actor.userId}`,
      id: persona.id,
      name: persona.name,
      version: persona.version,
      prompt: persona.prompt,
    },
  }
}

export type PersonaPreview = Exclude<Awaited<ReturnType<typeof resolvePersonaPreview>>, NextResponse>

/** A session may only be resumed by its creator through the same persona preview. */
export async function loadPersonaPreviewSession(preview: PersonaPreview, sessionId: string) {
  const { data, error } = await supabase.from("sessions")
    .select("id, status, profile, applicant_email, applicant_name, applicant_details, application_audience")
    .eq("session_id", sessionId)
    .eq("organisation_id", preview.context.organisationId)
    .eq("project_id", preview.context.projectId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const snapshot = data.profile?.persona_preview as PersonaPreview["snapshot"] | undefined
  if (snapshot?.actor !== preview.snapshot.actor || snapshot.id !== preview.snapshot.id ||
      typeof snapshot.prompt !== "string" || !snapshot.prompt.trim()) {
    return NextResponse.json({ error: "Preview session not found. Start a new preview." }, { status: 404 })
  }
  return { ...data, snapshot }
}
