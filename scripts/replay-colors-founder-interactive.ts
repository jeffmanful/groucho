import { createHash, randomBytes, randomUUID } from "node:crypto"
import { createInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"
import { createClient } from "@supabase/supabase-js"
import { generateDetailedReviewerReport } from "../lib/detailed-reviewer-report"
import { collectApplicationFacts } from "../lib/application-facts"
import { collectApplicationIntegrityConcerns } from "../lib/application-integrity-concerns"
import { normaliseReviewerReport } from "../lib/reviewer-report"
import { COLORS_FORUM_V1_RUBRIC } from "../lib/application-signal-state"
import { auditColorsConversationIntegrity, groundColorsProfile, pendingColorsReport } from "../lib/colors-post-conversation"
import { extractProfile } from "../lib/profile-extraction"
import { COLORS_PROFILE_EXTRACTOR_HINT, COLORS_PROFILE_SCHEMA, COLORS_THIN_PROFILE_EVIDENCE_HINT } from "../lib/onboarding-persona-template"
import {
  DEMO_AUTH_COOKIE,
  DEMO_SESSION_COOKIE,
  expectedTesterEmail,
  issueDemoToken,
} from "../lib/colors-demo-token"

const PROJECT_ID = "e9e6aa45-5ef3-4ec3-9451-1703d32abed3"
const BASE_URL = process.env.FOUNDER_REPLAY_BASE_URL ?? "http://127.0.0.1:3000"
const USE_DEMO = process.env.FOUNDER_REPLAY_DEMO === "1"
const USE_DEMO_REPORT = process.env.PILOT_REPLAY_DEMO_REPORT === "1"
const REPORT_SESSION_ID = process.env.PILOT_REPLAY_REPORT_SESSION_ID?.trim()
const ANALYZE_UNCLOSED = process.env.PILOT_REPLAY_ANALYZE_UNCLOSED === "1"
const PERSONA_SLUG = process.env.PILOT_REPLAY_PERSONA_SLUG?.trim() || "founder-replay"
const PERSONA_NAME = process.env.PILOT_REPLAY_PERSONA_NAME?.trim() || "Synthetic founder-lens curator"

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!url || !serviceKey) throw new Error("Supabase service configuration is required")
  const supabase = createClient(url, serviceKey)
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, organisation_id")
    .eq("id", PROJECT_ID)
    .single()
  if (projectError || !project) throw projectError ?? new Error("COLORS project unavailable")

  let temporaryKey: { id: string; plaintext: string } | null = null
  if (!USE_DEMO && !REPORT_SESSION_ID) {
    const plaintext = `gk_${randomBytes(24).toString("base64url")}`
    const keyHash = createHash("sha256").update(plaintext).digest("hex")
    const { data: keyRow, error: keyError } = await supabase
      .from("api_keys")
      .insert({
        organisation_id: project.organisation_id,
        project_id: PROJECT_ID,
        key_hash: keyHash,
        key_prefix: plaintext.slice(0, 12),
        label: `Temporary COLORS ${PERSONA_SLUG} replay`,
      })
      .select("id")
      .single()
    if (keyError || !keyRow) throw keyError ?? new Error("Could not create temporary key")
    temporaryKey = { id: keyRow.id, plaintext }
  }

  const sessionId = REPORT_SESSION_ID || randomUUID()
  stdout.write(`SESSION_ID=${sessionId}\n`)
  const testerEmail = expectedTesterEmail()
  const testerToken = USE_DEMO
    ? await issueDemoToken({ kind: "tester", email: testerEmail, issuedAt: Date.now() })
    : null
  const sessionToken = USE_DEMO
    ? await issueDemoToken({ kind: "session", email: testerEmail, sessionId, issuedAt: Date.now() })
    : null
  if (USE_DEMO && (!testerToken || !sessionToken)) throw new Error("Demo tokens unavailable")
  const applicant = {
    email: `${PERSONA_SLUG}-${sessionId}@example.invalid`,
    name: PERSONA_NAME,
  }
  const reader = createInterface({ input: stdin, output: stdout })
  const request = async (path: string, body: unknown) => {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        ...(temporaryKey ? { authorization: `Bearer ${temporaryKey.plaintext}` } : {}),
        "content-type": "application/json",
        ...(USE_DEMO ? {
          cookie: `${DEMO_AUTH_COOKIE}=${testerToken}; ${DEMO_SESSION_COOKIE}=${sessionToken}`,
        } : {}),
      },
      body: JSON.stringify(body),
    })
    const payload = await response.json() as Record<string, unknown>
    if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(payload)}`)
    return payload
  }

  try {
    if (!REPORT_SESSION_ID) {
      let response = await request(
        USE_DEMO ? "/api/demo/colors/start" : `/v1/sessions/${sessionId}/start`,
        USE_DEMO ? { sessionId, applicant } : { applicant },
      )
      let turn = 0
      while (response.status === "active" && turn < 16) {
        turn += 1
        stdout.write(`\nGroucho ${turn}: ${String(response.message ?? "")}\n`)
        const ui = response.ui as Record<string, unknown> | undefined
        if (ui?.inputType === "mediaChoice") {
          stdout.write(`MEDIA_CHOICE=${JSON.stringify(ui.mediaChoice)}\n`)
        } else if (Array.isArray(ui?.referenceCards) && ui.referenceCards.length > 0) {
          stdout.write(`REFERENCE_CARDS=${JSON.stringify(ui.referenceCards)}\n`)
        } else if (ui?.inputType === "singleSelect") {
          stdout.write(`OPTIONS=${JSON.stringify(ui.options)}\n`)
        }
        const line = (await reader.question("Applicant (text or JSON): ")).trim()
        if (!line) throw new Error("Empty applicant answer; stopping")
        const answer = line.startsWith("{")
          ? JSON.parse(line) as { message: string; interactionAnswer?: unknown }
          : { message: line }
        response = await request(USE_DEMO ? "/api/demo/colors/message" : `/v1/sessions/${sessionId}/messages`, {
          ...answer,
          applicant,
          ...(USE_DEMO ? { sessionId } : {}),
        })
      }
      stdout.write(`\nFINAL=${JSON.stringify({ sessionId, status: response.status, message: response.message, turns: turn })}\n`)
    } else {
      stdout.write(`\nREPORT_SESSION=${sessionId}\n`)
    }
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("id, status")
      .eq("session_id", sessionId)
      .eq("project_id", PROJECT_ID)
      .single()
    if (sessionError || !session) throw sessionError ?? new Error("Session missing")
    const { data: rows, error: rowsError } = await supabase
      .from("messages")
      .select("id, role, content, metadata")
      .eq("session_id", session.id)
      .order("sent_at", { ascending: true })
    if (rowsError || !rows) throw rowsError ?? new Error("Transcript missing")
    const diagnosticFinalAnswer = process.env.PILOT_REPLAY_DIAGNOSTIC_FINAL_ANSWER?.trim()
    if (ANALYZE_UNCLOSED && diagnosticFinalAnswer) {
      rows.push({
        id: randomUUID(),
        role: "user",
        content: diagnosticFinalAnswer,
        metadata: { diagnostic_unpersisted_answer: true },
      })
    }
    if (REPORT_SESSION_ID) {
      stdout.write(`TRANSCRIPT_MESSAGES=${rows.length}\n`)
    } else {
      stdout.write(`TRANSCRIPT=${JSON.stringify(rows.map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        relation: (row.metadata as Record<string, unknown> | null)?.application_answer_relation,
        nextSignal: (row.metadata as Record<string, unknown> | null)?.application_next_signal,
        recovered: (row.metadata as Record<string, unknown> | null)?.application_recovered_signal_evidence,
        mediaDepth: (row.metadata as Record<string, unknown> | null)?.application_media_depth_followup,
        uiType: ((row.metadata as Record<string, unknown> | null)?.ui as Record<string, unknown> | undefined)?.inputType,
      })))}\n`)
    }
    if (!["passed", "redirected", "rejected", "completed"].includes(session.status) && !ANALYZE_UNCLOSED) return
    const lastAssistant = [...rows].reverse().find((row) => row.role === "assistant")
    const metadata = lastAssistant?.metadata as Record<string, unknown> | undefined
    const baseReport = normaliseReviewerReport(metadata?.reviewer_report)
    if (USE_DEMO && USE_DEMO_REPORT) {
      const generated = await request("/api/demo/colors/report", { sessionId })
      stdout.write(`REPORT=${JSON.stringify(generated)}\n`)
      return
    }
    const diagnosticAudit = ANALYZE_UNCLOSED
      ? await auditColorsConversationIntegrity({
          messages: rows,
          organisationId: project.organisation_id,
          projectId: PROJECT_ID,
          sessionId,
        })
      : null
    const diagnosticBase = diagnosticAudit
      ? {
          ...pendingColorsReport(rows),
          safety_or_integrity_flags: [...new Set(diagnosticAudit.concerns.map((concern) => concern.reviewerFlag).filter(Boolean))],
        }
      : baseReport
    if (!diagnosticBase) throw new Error("Base reviewer report missing")
    const report = await generateDetailedReviewerReport({
      transcript: rows
        .filter((row) => row.role === "user" || row.role === "assistant")
        .map((row) => ({
          id: row.id as string,
          role: row.role as "user" | "assistant",
          content: row.content as string,
        })),
      baseReport: diagnosticBase,
      facts: collectApplicationFacts(rows
        .filter((row) => row.role === "user" || row.role === "assistant")
        .map((row) => ({
          id: row.id as string,
          role: row.role as "user" | "assistant",
          content: row.content as string,
          metadata: row.metadata,
        }))),
      integrityObservations: diagnosticAudit?.concerns ?? collectApplicationIntegrityConcerns(rows
        .filter((row) => row.role === "user" || row.role === "assistant")
        .map((row) => ({
          id: row.id as string,
          role: row.role as "user" | "assistant",
          content: row.content as string,
          metadata: row.metadata,
        }))),
      excludedApplicantMessageIds: rows.flatMap((row) =>
        row.role === "user" && (row.metadata as Record<string, unknown> | null)?.application_media_request
          ? [row.id as string]
          : [],
      ).concat(diagnosticAudit?.processMessageIds ?? []),
      organisationId: project.organisation_id,
      projectId: PROJECT_ID,
      sessionId,
      terminalStatus: session.status,
      rubricVersion: rows.some((row) =>
        (row.metadata as Record<string, unknown> | null)?.application_rubric_version === COLORS_FORUM_V1_RUBRIC,
      ) ? COLORS_FORUM_V1_RUBRIC : undefined,
      ...(diagnosticAudit ? { modelOverride: process.env.GROUCHO_COLORS_THIN_REVIEWER_MODEL?.trim() || "claude-sonnet-5-5" } : {}),
    })
    stdout.write(`REPORT=${JSON.stringify(report)}\n`)
    if (ANALYZE_UNCLOSED) {
      const profile = await extractProfile({
        transcript: rows.filter((row) => row.role === "user" || row.role === "assistant")
          .map((row) => ({ role: row.role as "user" | "assistant", content: row.content as string })),
        persona: {
          profile_schema: COLORS_PROFILE_SCHEMA,
          profile_extractor_hint: `${COLORS_PROFILE_EXTRACTOR_HINT} ${COLORS_THIN_PROFILE_EVIDENCE_HINT}`,
        },
        organisationId: project.organisation_id,
        projectId: PROJECT_ID,
        sessionId,
        terminalStatus: session.status,
      })
      stdout.write(`PROFILE=${JSON.stringify(groundColorsProfile(profile, diagnosticAudit?.concerns ?? []))}\n`)
    }
  } finally {
    reader.close()
    if (temporaryKey) {
      const { error } = await supabase
        .from("api_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", temporaryKey.id)
      if (error) throw error
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
