/**
 * Re-evaluate **active** sessions and set `passed` / `redirected` / `rejected`
 * when the last assistant turn already contains a structured `terminal` (in
 * message metadata) or legacy pass/redirect/reject tokens, using the same
 * scoring thresholds as live chat.
 *
 * Usage (from repo root, loads `.env.local` via Node):
 *
 *   pnpm run backfill:session-decisions -- --dry-run
 *   pnpm run backfill:session-decisions -- --project=<uuid> --limit=100
 *
 * Env: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
 */

import { randomUUID } from "crypto"
import type { ConversationMessage, Score } from "@/lib/scoring"
import {
  computeTerminalStatusFromGatekeeperTurn,
  parseAssistantStructuredMeta,
} from "@/lib/gatekeeper-session-status"
import { getServiceSupabase } from "@/lib/supabase"
import { recordVerdictAndEnqueueWebhooks } from "@/lib/verdict-webhook"

const NEUTRAL: Score = {
  specificity: 0.5,
  authenticity: 0.5,
  cultural_depth: 0.5,
  overall: 0.5,
}

type MsgRow = {
  id: string
  role: string
  content: string
  metadata: unknown
  sent_at: string
}

function parseArgs(argv: string[]) {
  let dryRun = false
  let force = false
  let projectId: string | undefined
  let limit = 500
  for (const a of argv) {
    if (a === "--dry-run") dryRun = true
    else if (a === "--force") force = true
    else if (a.startsWith("--project="))
      projectId = a.slice("--project=".length).trim() || undefined
    else if (a.startsWith("--limit=")) {
      const n = Number(a.slice("--limit=".length))
      if (Number.isFinite(n) && n > 0) limit = Math.min(n, 10_000)
    }
  }
  return { dryRun, force, projectId, limit }
}

function scoresFromUserMetadata(meta: unknown): Score {
  if (!meta) return NEUTRAL
  let obj: unknown = meta
  if (typeof meta === "string") {
    try {
      obj = JSON.parse(meta) as unknown
    } catch {
      return NEUTRAL
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return NEUTRAL
  const s = (obj as Record<string, unknown>).scores
  if (!s || typeof s !== "object" || Array.isArray(s)) return NEUTRAL
  const r = s as Record<string, unknown>
  const overall = Number(r.overall)
  const specificity = Number(r.specificity)
  const authenticity = Number(r.authenticity)
  const cultural_depth = Number(r.cultural_depth)
  if (
    [overall, specificity, authenticity, cultural_depth].every((x) =>
      Number.isFinite(x),
    )
  ) {
    return { specificity, authenticity, cultural_depth, overall }
  }
  return NEUTRAL
}

function scoreBasedDecision(
  scores: Score,
  passThreshold: number,
  rejectThreshold: number,
): "passed" | "redirected" | "rejected" {
  if (scores.overall >= passThreshold) return "passed"
  if (scores.overall <= rejectThreshold) return "rejected"
  return "redirected"
}

async function main() {
  const { dryRun, force, projectId, limit } = parseArgs(process.argv.slice(2))
  const supabase = getServiceSupabase()

  let q = supabase
    .from("sessions")
    .select("id, session_id, organisation_id, project_id, status, persona_id")
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(limit)

  if (projectId) q = q.eq("project_id", projectId)

  const { data: sessions, error: sErr } = await q
  if (sErr) {
    console.error("sessions query:", sErr.message)
    process.exit(1)
  }
  if (!sessions?.length) {
    console.log("No active sessions matched.")
    return
  }

  let resolved = 0
  let skipped = 0
  let errors = 0

  for (const row of sessions) {
    const sessionRowId = row.id as string
    const clientSessionKey = row.session_id as string
    const organisationId = row.organisation_id as string
    const projId = row.project_id as string
    const personaId = row.persona_id as string | null

    const { data: msgs, error: mErr } = await supabase
      .from("messages")
      .select("id, role, content, metadata, sent_at")
      .eq("session_id", sessionRowId)
      .order("sent_at", { ascending: true })

    if (mErr || !msgs?.length) {
      skipped++
      continue
    }

    const list = msgs as MsgRow[]
    let lastAsst = -1
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]!.role === "assistant") {
        lastAsst = i
        break
      }
    }
    if (lastAsst < 0) {
      skipped++
      continue
    }

    let scores = NEUTRAL
    for (let j = lastAsst - 1; j >= 0; j--) {
      if (list[j]!.role === "user") {
        scores = scoresFromUserMetadata(list[j]!.metadata)
        break
      }
    }

    const asst = list[lastAsst]!
    const { terminal: structuredTerminal, toolUsed: structuredToolUsed } =
      parseAssistantStructuredMeta(asst.metadata)

    const personaCols =
      "id, pass_threshold, reject_threshold, profile_schema, profile_extractor_hint"
    let personaRow: {
      pass_threshold: number
      reject_threshold: number
      profile_schema?: unknown
      profile_extractor_hint?: string | null
    } | null = null

    if (personaId) {
      const { data } = await supabase
        .from("personas")
        .select(personaCols)
        .eq("id", personaId)
        .eq("is_active", true)
        .maybeSingle()
      personaRow = data as typeof personaRow
    }
    if (!personaRow) {
      const { data } = await supabase
        .from("personas")
        .select(personaCols)
        .eq("is_active", true)
        .eq("is_default", true)
        .maybeSingle()
      personaRow = data as typeof personaRow
    }

    const passThreshold = personaRow?.pass_threshold ?? 0.65
    const rejectThreshold = personaRow?.reject_threshold ?? 0.25

    const status = computeTerminalStatusFromGatekeeperTurn({
      assistantContent: asst.content ?? "",
      scores,
      passThreshold,
      rejectThreshold,
      structuredTerminal,
      structuredToolUsed,
    })

    if (status === null) {
      if (!force) {
        console.log(
          `[skip] ${sessionRowId.slice(0, 8)}… no terminal signal (client key ${clientSessionKey.slice(0, 8)}…) — use --force to decide by scores`,
        )
        skipped++
        continue
      }
      const forced = scoreBasedDecision(scores, passThreshold, rejectThreshold)
      console.log(
        `[${dryRun ? "dry-run" : "apply"}] ${sessionRowId} → ${forced} (forced by scores overall=${scores.overall.toFixed(2)}, project ${projId})`,
      )
      if (dryRun) {
        resolved++
        continue
      }

      let successSecret: string | null = null
      if (forced === "passed") {
        successSecret = randomUUID()
        const { error: uErr } = await supabase
          .from("sessions")
          .update({ status: forced, success_secret: successSecret })
          .eq("id", sessionRowId)
          .eq("status", "active")
        if (uErr) {
          console.error("  session update failed:", uErr.message)
          errors++
          continue
        }
      } else {
        const { error: uErr } = await supabase
          .from("sessions")
          .update({ status: forced })
          .eq("id", sessionRowId)
          .eq("status", "active")
        if (uErr) {
          console.error("  session update failed:", uErr.message)
          errors++
          continue
        }
      }

      const transcript: ConversationMessage[] = list.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }))

      try {
        await recordVerdictAndEnqueueWebhooks({
          organisationId,
          projectId: projId,
          sessionInternalId: sessionRowId,
          clientSessionKey,
          terminalStatus: forced,
          scores,
          persona: personaRow
            ? {
                profile_schema: personaRow.profile_schema ?? null,
                profile_extractor_hint:
                  personaRow.profile_extractor_hint ?? null,
              }
            : null,
          transcript,
        })
      } catch (e) {
        console.error(
          "  verdict/webhook:",
          e instanceof Error ? e.message : String(e),
        )
        errors++
        continue
      }

      resolved++
      continue
    }

    console.log(
      `[${dryRun ? "dry-run" : "apply"}] ${sessionRowId} → ${status} (project ${projId})`,
    )

    if (dryRun) {
      resolved++
      continue
    }

    let successSecret: string | null = null
    if (status === "passed") {
      successSecret = randomUUID()
      const { error: uErr } = await supabase
        .from("sessions")
        .update({ status, success_secret: successSecret })
        .eq("id", sessionRowId)
        .eq("status", "active")
      if (uErr) {
        console.error("  session update failed:", uErr.message)
        errors++
        continue
      }
    } else {
      const { error: uErr } = await supabase
        .from("sessions")
        .update({ status })
        .eq("id", sessionRowId)
        .eq("status", "active")
      if (uErr) {
        console.error("  session update failed:", uErr.message)
        errors++
        continue
      }
    }

    const transcript: ConversationMessage[] = list.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }))

    try {
      await recordVerdictAndEnqueueWebhooks({
        organisationId,
        projectId: projId,
        sessionInternalId: sessionRowId,
        clientSessionKey,
        terminalStatus: status,
        scores,
        persona: personaRow
          ? {
              profile_schema: personaRow.profile_schema ?? null,
              profile_extractor_hint: personaRow.profile_extractor_hint ?? null,
            }
          : null,
        transcript,
      })
    } catch (e) {
      console.error(
        "  verdict/webhook:",
        e instanceof Error ? e.message : String(e),
      )
      errors++
      continue
    }

    resolved++
  }

  console.log(
    `\nDone. resolved=${resolved} skipped=${skipped} errors=${errors} dryRun=${dryRun}`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
