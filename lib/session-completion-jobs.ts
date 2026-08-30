import { recordCompletedSessionCulturalSignals } from "@/lib/cultural-signals"
import { log } from "@/lib/logger"
import { normaliseReviewerReport } from "@/lib/reviewer-report"
import type { Score } from "@/lib/scoring"
import { supabase } from "@/lib/supabase"
import { after } from "next/server"
import {
  recordVerdictAndEnqueueWebhooks,
  type TerminalSessionStatus,
} from "@/lib/verdict-webhook"

type CompletionJob = {
  id: string
  organisation_id: string
  project_id: string
  session_id: string
  likely_bot: boolean
  attempt_count: number
  max_attempts: number
}

const NEUTRAL_SCORES: Score = {
  specificity: 0.5,
  authenticity: 0.5,
  cultural_depth: 0.5,
  overall: 0.5,
}

function scoreValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0.5
}

function scoresFromMetadata(metadata: unknown): Score {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { ...NEUTRAL_SCORES }
  }
  const scores = (metadata as Record<string, unknown>).scores
  if (!scores || typeof scores !== "object" || Array.isArray(scores)) {
    return { ...NEUTRAL_SCORES }
  }
  const values = scores as Record<string, unknown>
  return {
    specificity: scoreValue(values.specificity),
    authenticity: scoreValue(values.authenticity),
    cultural_depth: scoreValue(values.cultural_depth),
    overall: scoreValue(values.overall),
  }
}

function retryDelaySeconds(attempt: number): number {
  return Math.min(3600, Math.max(15, 15 * 2 ** Math.max(0, attempt - 1)))
}

export async function enqueueSessionCompletionJob(input: {
  organisationId: string
  projectId: string
  sessionId: string
  likelyBot: boolean
}): Promise<void> {
  const { error } = await supabase.from("session_completion_jobs").upsert(
    {
      organisation_id: input.organisationId,
      project_id: input.projectId,
      session_id: input.sessionId,
      likely_bot: input.likelyBot,
      status: "pending",
      next_retry_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "session_id", ignoreDuplicates: true },
  )
  if (error) throw error
}

export function scheduleSessionCompletionDrain(): void {
  if (process.env.NODE_ENV === "test") return
  after(async () => {
    try {
      await processPendingSessionCompletionJobs(3)
    } catch (error) {
      log.error("session_completion_drain_failed", {
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  })
}

async function completeJob(job: CompletionJob): Promise<void> {
  const [{ data: session, error: sessionError }, { data: project, error: projectError }] =
    await Promise.all([
      supabase
        .from("sessions")
        .select(
          "id, session_id, status, persona_id, applicant_email, applicant_name",
        )
        .eq("id", job.session_id)
        .eq("project_id", job.project_id)
        .eq("organisation_id", job.organisation_id)
        .maybeSingle(),
      supabase
        .from("projects")
        .select("settings")
        .eq("id", job.project_id)
        .eq("organisation_id", job.organisation_id)
        .maybeSingle(),
    ])
  if (sessionError || !session) {
    throw sessionError ?? new Error("Completion session not found")
  }
  if (projectError || !project) {
    throw projectError ?? new Error("Completion project not found")
  }
  if (!["passed", "redirected", "rejected"].includes(session.status)) {
    throw new Error(`Session is not terminal: ${session.status}`)
  }

  const [{ data: messages, error: messagesError }, { data: persona, error: personaError }] =
    await Promise.all([
      supabase
        .from("messages")
        .select("id, role, content, metadata")
        .eq("session_id", job.session_id)
        .order("sent_at", { ascending: true }),
      session.persona_id
        ? supabase
            .from("personas")
            .select("profile_schema, profile_extractor_hint")
            .eq("id", session.persona_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])
  if (messagesError) throw messagesError
  if (personaError) throw personaError

  const rows = messages ?? []
  const terminalAssistant = [...rows]
    .reverse()
    .find((message) => message.role === "assistant")
  const latestUser = [...rows]
    .reverse()
    .find((message) => message.role === "user")
  const terminalMetadata = terminalAssistant?.metadata
  const metadataObject =
    terminalMetadata &&
    typeof terminalMetadata === "object" &&
    !Array.isArray(terminalMetadata)
      ? (terminalMetadata as Record<string, unknown>)
      : {}
  const reviewerReport = normaliseReviewerReport(
    metadataObject.reviewer_report,
  )
  const scores = scoresFromMetadata(latestUser?.metadata)

  await Promise.all([
    recordVerdictAndEnqueueWebhooks({
      organisationId: job.organisation_id,
      projectId: job.project_id,
      sessionInternalId: job.session_id,
      clientSessionKey: session.session_id,
      terminalStatus: session.status as TerminalSessionStatus,
      scores,
      reviewerReport,
      persona: persona
        ? {
            profile_schema: persona.profile_schema ?? null,
            profile_extractor_hint: persona.profile_extractor_hint ?? null,
          }
        : null,
      transcript: rows.map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content,
      })),
      applicant: session.applicant_email
        ? {
            email: session.applicant_email,
            ...(session.applicant_name ? { name: session.applicant_name } : {}),
          }
        : null,
    }),
    recordCompletedSessionCulturalSignals({
      organisationId: job.organisation_id,
      projectId: job.project_id,
      sessionId: job.session_id,
      settings: project.settings,
      likelyBot: job.likely_bot,
      messages: rows.map((message) => ({
        id: message.id,
        role: message.role as "user" | "assistant",
        content: message.content,
        metadata: message.metadata,
      })),
    }),
  ])
}

export async function completeSessionImmediately(input: {
  organisationId: string
  projectId: string
  sessionId: string
  likelyBot: boolean
}): Promise<void> {
  await completeJob({
    id: "inline-fallback",
    organisation_id: input.organisationId,
    project_id: input.projectId,
    session_id: input.sessionId,
    likely_bot: input.likelyBot,
    attempt_count: 1,
    max_attempts: 1,
  })
}

async function markJobFailed(job: CompletionJob, error: unknown): Promise<void> {
  const detail = error instanceof Error ? error.message : String(error)
  const exhausted = job.attempt_count >= job.max_attempts
  const nextRetryAt = new Date(
    Date.now() + retryDelaySeconds(job.attempt_count) * 1000,
  ).toISOString()
  await supabase
    .from("session_completion_jobs")
    .update({
      status: exhausted ? "failed" : "pending",
      last_error: detail.slice(0, 1000),
      locked_at: null,
      next_retry_at: nextRetryAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)
}

export async function processPendingSessionCompletionJobs(
  limit = 10,
): Promise<number> {
  const { data, error } = await supabase.rpc("claim_session_completion_jobs", {
    p_limit: Math.max(1, Math.min(limit, 50)),
  })
  if (error) throw error
  const jobs = (data ?? []) as CompletionJob[]
  for (const job of jobs) {
    try {
      await completeJob(job)
      await supabase
        .from("session_completion_jobs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          locked_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
    } catch (error) {
      log.error("session_completion_job_failed", {
        jobId: job.id,
        projectId: job.project_id,
        sessionId: job.session_id,
        attempt: job.attempt_count,
        detail: error instanceof Error ? error.message : String(error),
      })
      await markJobFailed(job, error)
    }
  }
  return jobs.length
}
