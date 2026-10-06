import { createClient } from "@supabase/supabase-js"
import { COLORS_FORUM_PERSONA_PROMPT } from "../lib/colors-forum-persona"

const PROJECT_ID = "e9e6aa45-5ef3-4ec3-9451-1703d32abed3"
const PERSONA_SLUG = "colors-forum-groucho-pilot"

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!url || !serviceKey) throw new Error("Supabase service configuration is required")
  const db = createClient(url, serviceKey)
  const { data: project, error: projectError } = await db.from("projects")
    .select("id, name, settings")
    .eq("id", PROJECT_ID)
    .single()
  if (projectError || !project) throw projectError ?? new Error("COLORS project not found")
  if (project.name !== "Forum Application") throw new Error("Unexpected project; refusing to modify persona")
  const settings = project.settings as Record<string, unknown> | null
  const oldPersonaId = typeof settings?.persona_id === "string" ? settings.persona_id : null
  if (!settings || !oldPersonaId) throw new Error("Project persona is missing")

  const { data: oldPersona, error: oldError } = await db.from("personas")
    .select("id, pass_threshold, reject_threshold, profile_extractor_hint")
    .eq("id", oldPersonaId)
    .single()
  if (oldError || !oldPersona) throw oldError ?? new Error("Current persona not found")
  const { data: existing, error: existingError } = await db.from("personas")
    .select("id, prompt, is_active")
    .eq("slug", PERSONA_SLUG)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing && (existing.prompt !== COLORS_FORUM_PERSONA_PROMPT || !existing.is_active)) {
    throw new Error("Pilot persona already exists with different content; refusing to overwrite it")
  }
  if (!process.argv.includes("--apply")) {
    console.log(JSON.stringify({ mode: "dry-run", projectId: PROJECT_ID, oldPersonaId, newPersonaId: existing?.id ?? null, willCreate: !existing }))
    return
  }

  let newPersonaId = existing?.id
  if (!newPersonaId) {
    const { data: created, error } = await db.from("personas").insert({
      name: "COLORS Forum Groucho (pilot)",
      slug: PERSONA_SLUG,
      prompt: COLORS_FORUM_PERSONA_PROMPT,
      is_active: true,
      is_default: false,
      pass_threshold: oldPersona.pass_threshold,
      reject_threshold: oldPersona.reject_threshold,
      profile_extractor_hint: oldPersona.profile_extractor_hint,
    }).select("id").single()
    if (error || !created) throw error ?? new Error("Could not create pilot persona")
    newPersonaId = created.id
  }
  const { error: updateError } = await db.from("projects")
    .update({ settings: { ...settings, persona_id: newPersonaId } })
    .eq("id", PROJECT_ID)
  if (updateError) throw updateError
  const { data: verified, error: verifyError } = await db.from("projects")
    .select("settings")
    .eq("id", PROJECT_ID)
    .single()
  if (verifyError || verified?.settings?.persona_id !== newPersonaId) {
    throw verifyError ?? new Error("Persona assignment was not persisted")
  }
  console.log(JSON.stringify({ mode: "applied", projectId: PROJECT_ID, oldPersonaId, newPersonaId }))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
