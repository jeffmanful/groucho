import { createHmac, randomBytes, randomUUID } from "crypto"
import type { ApplicantIdentity } from "@/lib/applicant-identity"
import type { ConversationMessage, Score } from "@/lib/scoring"
import { supabase } from "@/lib/supabase"
import {
  extractProfile,
  summariseProfileForLog,
  type PersonaForExtraction,
  type Profile,
} from "@/lib/profile-extraction"
import { log } from "@/lib/logger"

export type TerminalSessionStatus = "passed" | "redirected" | "rejected"

export function sessionStatusToOutcome(
  s: TerminalSessionStatus,
): "PASS" | "REDIRECT" | "REJECT" {
  if (s === "passed") return "PASS"
  if (s === "redirected") return "REDIRECT"
  return "REJECT"
}

function isDryRun(settings: unknown): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return false
  const m = settings as Record<string, unknown>
  return m.session_mode === "dry-run"
}

export type VerdictPayload = {
  event: "session.completed"
  id: string
  occurred_at: string
  project: { id: string; organisation_id: string }
  project_type?: "gatekeeper" | "onboarding"
  flow_version?: string
  session: {
    client_session_key: string
    internal_id: string
    status: string
  }
  applicant?: ApplicantIdentity
  outcome: "PASS" | "REDIRECT" | "REJECT"
  scores?: Score
  profile?: Profile
}

const DEFAULT_PROFILE_EXTRACT_STATUSES: TerminalSessionStatus[] = [
  "passed",
  "redirected",
  "rejected",
]

function resolveExtractStatuses(
  settings: unknown,
  projectType: "gatekeeper" | "onboarding",
): TerminalSessionStatus[] | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return projectType === "onboarding" ? null : DEFAULT_PROFILE_EXTRACT_STATUSES
  }
  const raw = (settings as Record<string, unknown>).profile_extract_on
  if (raw === undefined) {
    return projectType === "onboarding" ? null : DEFAULT_PROFILE_EXTRACT_STATUSES
  }
  if (raw === false || raw === null) return null
  if (Array.isArray(raw)) {
    const filtered = raw.filter(
      (v): v is TerminalSessionStatus =>
        v === "passed" || v === "redirected" || v === "rejected",
    )
    return filtered.length ? filtered : null
  }
  return DEFAULT_PROFILE_EXTRACT_STATUSES
}

export async function recordVerdictAndEnqueueWebhooks(opts: {
  organisationId: string
  projectId: string
  sessionInternalId: string
  clientSessionKey: string
  terminalStatus: TerminalSessionStatus
  scores: Score
  /** Persona row used to decide custom profile extraction. */
  persona?: PersonaForExtraction | null
  /** Full conversation transcript to feed the extractor. */
  transcript?: ConversationMessage[]
  applicant?: ApplicantIdentity | null
}): Promise<{ profile: Profile | null }> {
  const { data: project } = await supabase
    .from("projects")
    .select("settings")
    .eq("id", opts.projectId)
    .maybeSingle()

  const projectSettings = project?.settings
  const projectTypeRaw =
    projectSettings &&
    typeof projectSettings === "object" &&
    !Array.isArray(projectSettings)
      ? (projectSettings as Record<string, unknown>).project_type
      : undefined
  const projectType =
    projectTypeRaw === "onboarding" ? "onboarding" : "gatekeeper"
  const flowVersionRaw =
    projectSettings &&
    typeof projectSettings === "object" &&
    !Array.isArray(projectSettings)
      ? (projectSettings as Record<string, unknown>).flow_config
      : undefined
  let flowVersion: string | undefined
  if (
    flowVersionRaw &&
    typeof flowVersionRaw === "object" &&
    !Array.isArray(flowVersionRaw)
  ) {
    const v = (flowVersionRaw as Record<string, unknown>).version
    if (typeof v === "string") flowVersion = v
  }

  const { data: sessionRow } = await supabase
    .from("sessions")
    .select("flow_version")
    .eq("id", opts.sessionInternalId)
    .maybeSingle()
  if (sessionRow?.flow_version && typeof sessionRow.flow_version === "string") {
    flowVersion = sessionRow.flow_version
  }

  if (isDryRun(project?.settings)) {
    return { profile: null }
  }

  const outcome = sessionStatusToOutcome(opts.terminalStatus)
  const occurredAt = new Date().toISOString()
  const verdictId = randomUUID()

  let profile: Profile | null = null
  const extractStatuses = resolveExtractStatuses(project?.settings, projectType)
  const shouldExtract =
    extractStatuses !== null &&
    extractStatuses.includes(opts.terminalStatus) &&
    Array.isArray(opts.transcript) &&
    opts.transcript.length > 0

  if (shouldExtract) {
    try {
      profile = await extractProfile({
        transcript: opts.transcript!,
        persona: opts.persona ?? null,
      })
      log.info("profile_extracted", {
        projectId: opts.projectId,
        sessionId: opts.sessionInternalId,
        ...summariseProfileForLog(profile),
      })
    } catch (err) {
      log.error("profile_extract_unexpected", {
        projectId: opts.projectId,
        sessionId: opts.sessionInternalId,
        detail: err instanceof Error ? err.message : String(err),
      })
      profile = null
    }
  }

  const payload: VerdictPayload = {
    event: "session.completed",
    id: verdictId,
    occurred_at: occurredAt,
    project: { id: opts.projectId, organisation_id: opts.organisationId },
    project_type: projectType,
    ...(flowVersion ? { flow_version: flowVersion } : {}),
    session: {
      client_session_key: opts.clientSessionKey,
      internal_id: opts.sessionInternalId,
      status: opts.terminalStatus,
    },
    ...(opts.applicant ? { applicant: opts.applicant } : {}),
    outcome,
    scores: opts.scores,
    ...(profile ? { profile } : {}),
  }

  const { data: verdict, error: vErr } = await supabase
    .from("verdicts")
    .insert({
      id: verdictId,
      organisation_id: opts.organisationId,
      project_id: opts.projectId,
      session_id: opts.sessionInternalId,
      outcome,
      session_status: opts.terminalStatus,
      payload: payload as unknown as Record<string, unknown>,
    })
    .select("id")
    .single()

  if (vErr) {
    if (vErr.code === "23505") {
      return { profile }
    }
    log.error("verdicts_insert_failed", {
      projectId: opts.projectId,
      sessionId: opts.sessionInternalId,
      detail: vErr.message,
    })
    return { profile }
  }

  if (!verdict) return { profile }

  const { data: hooks } = await supabase
    .from("webhooks")
    .select("id, events, url, signing_secret")
    .eq("project_id", opts.projectId)
    .eq("active", true)

  if (!hooks?.length) return { profile }

  const eventName = "session.completed"
  const deliveries: { id: string }[] = []

  for (const h of hooks) {
    const evs = h.events as string[] | null
    if (evs?.length && !evs.includes(eventName)) continue

    const { data: d, error: dErr } = await supabase
      .from("webhook_deliveries")
      .insert({
        webhook_id: h.id,
        verdict_id: verdict.id,
        next_retry_at: new Date().toISOString(),
        status: "pending",
      })
      .select("id")
      .single()

    if (dErr?.code === "23505") continue
    if (!dErr && d) deliveries.push({ id: d.id })
  }

  for (const d of deliveries) {
    void tryDeliverWebhook(d.id)
  }

  return { profile }
}

function signBody(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex")
}

export async function tryDeliverWebhook(deliveryId: string): Promise<void> {
  const { data: row, error } = await supabase
    .from("webhook_deliveries")
    .select("id, attempt_count, max_attempts, webhook_id, verdict_id, status")
    .eq("id", deliveryId)
    .maybeSingle()

  if (error || !row) {
    console.error("webhook_deliveries fetch:", error)
    return
  }

  if (row.status !== "pending") return

  const { data: wh, error: wErr } = await supabase
    .from("webhooks")
    .select("url, signing_secret")
    .eq("id", row.webhook_id as string)
    .maybeSingle()

  const { data: verdictRow, error: vErr } = await supabase
    .from("verdicts")
    .select("payload")
    .eq("id", row.verdict_id as string)
    .maybeSingle()

  if (wErr || vErr || !wh || !verdictRow) {
    console.error("webhook/verdict fetch:", wErr ?? vErr)
    return
  }

  const attempt = (row.attempt_count as number) + 1
  const max = (row.max_attempts as number) ?? 8
  const verdictPayload = verdictRow.payload as VerdictPayload

  const rawBody = JSON.stringify(verdictPayload)

  try {
    const res = await fetch(wh.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Groucho-Event": "session.completed",
        "X-Groucho-Delivery-Id": deliveryId,
        "X-Groucho-Signature": `sha256=${signBody(wh.signing_secret, rawBody)}`,
      },
      body: rawBody,
      signal: AbortSignal.timeout(15_000),
    })

    if (res.ok) {
      await supabase
        .from("webhook_deliveries")
        .update({
          status: "delivered",
          delivered_at: new Date().toISOString(),
          http_status: res.status,
          attempt_count: attempt,
          last_error: null,
        })
        .eq("id", deliveryId)
      return
    }

    const errText = await res.text().catch(() => "")
    await scheduleRetryOrFail(deliveryId, attempt, max, `HTTP ${res.status}: ${errText.slice(0, 500)}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await scheduleRetryOrFail(deliveryId, attempt, max, msg)
  }
}

async function scheduleRetryOrFail(
  deliveryId: string,
  attempt: number,
  max: number,
  lastError: string,
): Promise<void> {
  if (attempt >= max) {
    await supabase
      .from("webhook_deliveries")
      .update({
        status: "failed",
        attempt_count: attempt,
        last_error: lastError,
      })
      .eq("id", deliveryId)
    return
  }

  const backoffSec = Math.min(300, 10 * 2 ** (attempt - 1))
  const next = new Date(Date.now() + backoffSec * 1000).toISOString()

  await supabase
    .from("webhook_deliveries")
    .update({
      attempt_count: attempt,
      last_error: lastError,
      next_retry_at: next,
      status: "pending",
    })
    .eq("id", deliveryId)
}

export async function processPendingWebhookDeliveries(limit = 25): Promise<number> {
  const { data: rows } = await supabase
    .from("webhook_deliveries")
    .select("id")
    .eq("status", "pending")
    .lte("next_retry_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(limit)

  let n = 0
  for (const r of rows ?? []) {
    await tryDeliverWebhook(r.id as string)
    n += 1
  }
  return n
}

export function generateWebhookSigningSecret(): string {
  return randomBytes(32).toString("hex")
}
