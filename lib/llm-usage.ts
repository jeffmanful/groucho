import { log } from "@/lib/logger"
import { supabase } from "@/lib/supabase"

export const DEFAULT_LOW_COST_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"

type TokenUsage = {
  input_tokens?: unknown
  output_tokens?: unknown
  cache_creation_input_tokens?: unknown
  cache_read_input_tokens?: unknown
  cache_creation?: {
    ephemeral_5m_input_tokens?: unknown
    ephemeral_1h_input_tokens?: unknown
  } | null
}

type ModelPricing = {
  inputPerMillion: number
  outputPerMillion: number
  cacheWritePerMillion?: number
  cacheWrite1hPerMillion?: number
  cacheReadPerMillion?: number
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-haiku-4-5-20251001": {
    inputPerMillion: 1,
    outputPerMillion: 5,
    cacheWritePerMillion: 1.25,
    cacheWrite1hPerMillion: 2,
    cacheReadPerMillion: 0.1,
  },
  "claude-haiku-5-5": {
    inputPerMillion: 0.1,
    outputPerMillion: 0.5,
    cacheWritePerMillion: 0.125,
    cacheWrite1hPerMillion: 0.2,
    cacheReadPerMillion: 0.01,
  },
  "claude-sonnet-4-20250514": {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheWritePerMillion: 3.75,
    cacheWrite1hPerMillion: 6,
    cacheReadPerMillion: 0.3,
  },
  "claude-sonnet-5-5": {
    inputPerMillion: 2,
    outputPerMillion: 10,
    cacheWritePerMillion: 2.5,
    cacheWrite1hPerMillion: 4,
    cacheReadPerMillion: 0.1,
  },
  "claude-opus-4-6": {
    inputPerMillion: 5,
    outputPerMillion: 25,
    cacheWritePerMillion: 6.25,
    cacheWrite1hPerMillion: 10,
    cacheReadPerMillion: 0.5,
  },
  "gpt-5.6-luna": {
    inputPerMillion: 1,
    outputPerMillion: 6,
    cacheWritePerMillion: 1.25,
    cacheReadPerMillion: 0.1,
  },
  "gpt-5.6-terra": {
    inputPerMillion: 2.5,
    outputPerMillion: 15,
    cacheWritePerMillion: 3.125,
    cacheReadPerMillion: 0.25,
  },
}

function asTokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0
}

function cacheWriteTokens(usage: TokenUsage | null | undefined): {
  total: number
  fiveMinute: number
  oneHour: number
} {
  const total = asTokenCount(usage?.cache_creation_input_tokens)
  const oneHour = Math.min(total, asTokenCount(usage?.cache_creation?.ephemeral_1h_input_tokens))
  return { total, fiveMinute: total - oneHour, oneHour }
}

export function modelFromEnv(
  envName: string,
  fallback: string = DEFAULT_LOW_COST_ANTHROPIC_MODEL,
): string {
  return process.env[envName]?.trim() || fallback
}

export function estimateLlmCostUsd(
  model: string,
  usage: TokenUsage | null | undefined,
): number | null {
  const pricing = MODEL_PRICING[model]
  if (!pricing || !usage) return null

  const inputTokens = asTokenCount(usage.input_tokens)
  const outputTokens = asTokenCount(usage.output_tokens)
  const cacheWrites = cacheWriteTokens(usage)
  const cacheReadInputTokens = asTokenCount(usage.cache_read_input_tokens)

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion
  const cacheWriteCost =
    (cacheWrites.fiveMinute / 1_000_000) *
    (pricing.cacheWritePerMillion ?? pricing.inputPerMillion)
  const cacheWrite1hCost =
    (cacheWrites.oneHour / 1_000_000) *
    (pricing.cacheWrite1hPerMillion ?? pricing.inputPerMillion * 2)
  const cacheReadCost =
    (cacheReadInputTokens / 1_000_000) *
    (pricing.cacheReadPerMillion ?? pricing.inputPerMillion)

  return Number(
    (inputCost + outputCost + cacheWriteCost + cacheWrite1hCost + cacheReadCost).toFixed(8),
  )
}

export type LlmUsageLogInput = {
  operation: string
  provider: "anthropic" | "openai"
  model: string
  usage?: TokenUsage | null
  requestId?: string
  organisationId?: string
  projectId?: string
  sessionId?: string
  terminalStatus?: string
  providerResponseId?: string
}

/** Log every response and persist session-linked usage without changing the applicant flow on storage failure. */
export async function logLlmUsage(input: LlmUsageLogInput): Promise<void> {
  const usage = input.usage
  const inputTokens = asTokenCount(usage?.input_tokens)
  const outputTokens = asTokenCount(usage?.output_tokens)
  const cacheWrites = cacheWriteTokens(usage)
  const cacheReadInputTokens = asTokenCount(usage?.cache_read_input_tokens)
  const estimatedCostUsd = estimateLlmCostUsd(input.model, usage)

  log.info("llm_usage", {
    requestId: input.requestId,
    organisationId: input.organisationId,
    projectId: input.projectId,
    sessionId: input.sessionId,
    operation: input.operation,
    provider: input.provider,
    model: input.model,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens: cacheWrites.total,
    cacheCreation5mInputTokens: cacheWrites.fiveMinute,
    cacheCreation1hInputTokens: cacheWrites.oneHour,
    cacheReadInputTokens,
    estimatedCostUsd,
    terminalStatus: input.terminalStatus,
    providerResponseId: input.providerResponseId,
  })

  if (!input.projectId || !input.sessionId || !usage) return
  try {
    const external = await supabase.from("sessions").select("id")
      .eq("project_id", input.projectId).eq("session_id", input.sessionId).maybeSingle()
    if (external.error) throw external.error
    let sessionId = external.data?.id as string | undefined
    if (!sessionId && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(input.sessionId)) {
      const internal = await supabase.from("sessions").select("id")
        .eq("project_id", input.projectId).eq("id", input.sessionId).maybeSingle()
      if (internal.error) throw internal.error
      sessionId = internal.data?.id as string | undefined
    }
    if (!sessionId) throw new Error("Session not found for model usage")

    const { error } = await supabase.from("session_llm_usage").insert({
      session_id: sessionId,
      project_id: input.projectId,
      provider: input.provider,
      provider_response_id: input.providerResponseId ?? null,
      operation: input.operation,
      model: input.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: cacheWrites.total,
      cache_creation_5m_input_tokens: cacheWrites.fiveMinute,
      cache_creation_1h_input_tokens: cacheWrites.oneHour,
      cache_read_input_tokens: cacheReadInputTokens,
      estimated_cost_usd: estimatedCostUsd,
      pricing_per_million: MODEL_PRICING[input.model] ?? null,
    })
    if (error && error.code !== "23505") throw error
  } catch (error) {
    log.warn("llm_usage_persist_failed", {
      requestId: input.requestId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      operation: input.operation,
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}
