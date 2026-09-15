/**
 * Restore or generate missing profiles for completed sessions.
 *
 * Existing verdict-embedded profiles are copied first at no LLM cost. Remaining
 * profiles are extracted from the stored transcript. Updates are conditional on
 * `sessions.profile` still being null, making repeated runs safe.
 *
 * Usage:
 *   pnpm run backfill:session-profiles -- --project=forum-application --since=2026-07-30 --dry-run
 *   pnpm run backfill:session-profiles -- --project=forum-application --since=2026-07-30
 */

import { extractProfile, type PersonaForExtraction, type Profile } from "@/lib/profile-extraction"
import type { ConversationMessage } from "@/lib/scoring"
import { getServiceSupabase } from "@/lib/supabase"

const TERMINAL_STATUSES = ["passed", "redirected", "rejected"] as const

type SessionRow = {
  id: string
  organisation_id: string
  project_id: string
  persona_id: string | null
}

function parseArgs(argv: string[]) {
  let project = ""
  let since = ""
  let dryRun = false
  let limit = 500
  let concurrency = 2
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true
    else if (arg.startsWith("--project=")) project = arg.slice("--project=".length).trim()
    else if (arg.startsWith("--since=")) since = arg.slice("--since=".length).trim()
    else if (arg.startsWith("--limit=")) limit = Number(arg.slice("--limit=".length))
    else if (arg.startsWith("--concurrency=")) {
      concurrency = Number(arg.slice("--concurrency=".length))
    }
  }
  if (!project) throw new Error("--project=<slug-or-uuid> is required")
  if (!since || Number.isNaN(Date.parse(since))) {
    throw new Error("--since=<ISO date> is required")
  }
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer")
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5) {
    throw new Error("--concurrency must be an integer from 1 to 5")
  }
  return { project, since: new Date(since).toISOString(), dryRun, limit, concurrency }
}

function embeddedProfile(payload: unknown): Profile | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const profile = (payload as Record<string, unknown>).profile
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null
  return profile as Profile
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const db = getServiceSupabase()
  const projectLookup = db.from("projects").select("id, organisation_id, slug")
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    args.project,
  )
  const { data: project, error: projectError } = await (isUuid
    ? projectLookup.eq("id", args.project)
    : projectLookup.eq("slug", args.project)
  ).maybeSingle()
  if (projectError || !project) throw projectError ?? new Error("Project not found")

  const { data, error } = await db
    .from("sessions")
    .select("id, organisation_id, project_id, persona_id")
    .eq("project_id", project.id)
    .in("status", [...TERMINAL_STATUSES])
    .is("profile", null)
    .gte("created_at", args.since)
    .order("created_at", { ascending: true })
    .limit(Math.min(args.limit, 10_000))
  if (error) throw error

  const sessions = (data ?? []) as SessionRow[]
  console.log(
    `${args.dryRun ? "Would process" : "Processing"} ${sessions.length} missing profiles for ${project.slug}.`,
  )
  if (args.dryRun || sessions.length === 0) return

  let restored = 0
  let extracted = 0
  let failed = 0
  let nextIndex = 0

  async function processSession(session: SessionRow) {
    const { data: verdict } = await db
      .from("verdicts")
      .select("payload, created_at")
      .eq("session_id", session.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    const historical = embeddedProfile(verdict?.payload)
    if (historical) {
      const { error: restoreError } = await db
        .from("sessions")
        .update({
          profile: historical,
          profile_extracted_at: verdict?.created_at ?? new Date().toISOString(),
        })
        .eq("id", session.id)
        .is("profile", null)
      if (restoreError) throw restoreError
      restored++
      return
    }

    const [{ data: messages, error: messagesError }, personaResult] = await Promise.all([
      db
        .from("messages")
        .select("role, content")
        .eq("session_id", session.id)
        .order("sent_at", { ascending: true }),
      session.persona_id
        ? db
            .from("personas")
            .select("profile_schema, profile_extractor_hint")
            .eq("id", session.persona_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])
    if (messagesError) throw messagesError
    if (personaResult.error) throw personaResult.error

    const transcript: ConversationMessage[] = (messages ?? [])
      .filter(
        (message): message is { role: "assistant" | "user"; content: string } =>
          (message.role === "assistant" || message.role === "user") &&
          typeof message.content === "string",
      )
      .map((message) => ({ role: message.role, content: message.content }))
    if (!transcript.some((message) => message.role === "user")) {
      throw new Error("No applicant message")
    }

    const persona = (personaResult.data as PersonaForExtraction | null) ?? null
    const profile = await extractProfile({
      transcript,
      persona,
      organisationId: session.organisation_id,
      projectId: session.project_id,
      sessionId: session.id,
      terminalStatus: "backfill",
    })
    if (profile.extraction.status !== "ok") {
      throw new Error(profile.extraction.reason)
    }

    const { error: writeError } = await db
      .from("sessions")
      .update({ profile, profile_extracted_at: new Date().toISOString() })
      .eq("id", session.id)
      .is("profile", null)
    if (writeError) throw writeError
    extracted++
  }

  async function worker() {
    while (true) {
      const index = nextIndex++
      const session = sessions[index]
      if (!session) return
      try {
        await processSession(session)
      } catch (error) {
        failed++
        console.error(
          `[failed ${index + 1}/${sessions.length}] ${session.id.slice(0, 8)}…: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      if ((index + 1) % 10 === 0 || index + 1 === sessions.length) {
        console.log(
          `[progress ${index + 1}/${sessions.length}] restored=${restored} extracted=${extracted} failed=${failed}`,
        )
      }
    }
  }

  await Promise.all(Array.from({ length: args.concurrency }, () => worker()))
  console.log(`Done. restored=${restored} extracted=${extracted} failed=${failed}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
