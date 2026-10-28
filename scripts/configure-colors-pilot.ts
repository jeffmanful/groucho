import { createClient } from "@supabase/supabase-js"

// Creates an isolated review batch. It does not change the integration project, copy keys,
// enable the public route, send invitations or create webhook subscriptions.
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_KEY?.trim()
  if (!url || !key) throw new Error("Supabase service configuration is required")
  const db = createClient(url, key, { auth: { persistSession: false } })
  const slug = process.env.GROUCHO_COLORS_PILOT_PROJECT_SLUG?.trim() || "forum-application-pilot"
  if (["forum-application", "forum-application-test"].includes(slug)) throw new Error("Use a separate pilot project slug")
  const { data: org, error: orgError } = await db.from("organisations").select("id").ilike("name", "colors").single()
  if (orgError || !org) throw orgError ?? new Error("COLORS organisation not found")
  const { data: existing, error: existingError } = await db.from("projects").select("id, settings").eq("organisation_id", org.id).eq("slug", slug).maybeSingle()
  if (existingError) throw existingError
  if (existing) {
    console.log(JSON.stringify({ mode: "existing", projectId: existing.id, slug, note: "Existing configuration was not overwritten. Check manual policy, engine and active webhooks before enabling." }))
    return
  }
  const { data: source, error: sourceError } = await db.from("projects").select("settings").eq("organisation_id", org.id).eq("slug", "forum-application").single()
  if (sourceError || !source) throw sourceError ?? new Error("Source Forum project not found")
  const settings = {
    ...source.settings, project_type: "gatekeeper", conversation_engine: "colors_forum", archived: false,
    environment: "live", session_mode: "live", application_invitation_required: true,
    decision_policy: { automatic_acceptance_enabled: false, automatic_decline_enabled: false, acceptance_threshold: 0.8, review_threshold: 0.55 },
  }
  if (!process.argv.includes("--apply")) {
    console.log(JSON.stringify({ mode: "dry-run", slug, willCreate: true, engine: settings.conversation_engine, automaticDecisions: false, webhooks: 0 }))
    return
  }
  const { data: created, error } = await db.from("projects").insert({ organisation_id: org.id, name: "COLORS Forum pilot", slug, settings, expose_to_anon_read: false }).select("id, slug").single()
  if (error || !created) throw error ?? new Error("Pilot project could not be created")
  console.log(JSON.stringify({ mode: "created", projectId: created.id, slug: created.slug, forumPilotEnabled: false }))
}

main().catch(error => {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "Pilot configuration failed"
  console.error(message)
  process.exitCode = 1
})
