import { log } from "@/lib/logger"

export const DEFAULT_LOW_COST_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"

type TokenUsage = {
  input_tokens?: unknown
  output_tokens?: unknown
  cache_creation_input_tokens?: unknown
  cache_read_input_tokens?: unknown
}

type ModelPricing = {
  inputPerMillion: number
  outputPerMillion: number
  cacheWritePerMillion?: number
  cacheReadPerMillion?: number
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-haiku-4-5-20251001": {
    inputPerMillion: 1,
    outputPerMillion: 5,
    cacheWritePerMillion: 1.25,
    cacheReadPerMillion: 0.1,
  },
  "claude-sonnet-4-20250514": {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheWritePerMillion: 3.75,
    cacheReadPerMillion: 0.3,
  },
  "claude-opus-4-6": {
    inputPerMillion: 5,
    outputPerMillion: 25,
    cacheWritePerMillion: 6.25,
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
    ? Math.max(0, value)
    : 0
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
  const cacheCreationInputTokens = asTokenCount(
    usage.cache_creation_input_tokens,
  )
  const cacheReadInputTokens = asTokenCount(usage.cache_read_input_tokens)

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion
  const cacheWriteCost =
    (cacheCreationInputTokens / 1_000_000) *
    (pricing.cacheWritePerMillion ?? pricing.inputPerMillion)
  const cacheReadCost =
    (cacheReadInputTokens / 1_000_000) *
    (pricing.cacheReadPerMillion ?? pricing.inputPerMillion)

  return Number(
    (inputCost + outputCost + cacheWriteCost + cacheReadCost).toFixed(8),
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
}

export function logLlmUsage(input: LlmUsageLogInput): void {
  const usage = input.usage
  const inputTokens = asTokenCount(usage?.input_tokens)
  const outputTokens = asTokenCount(usage?.output_tokens)
  const cacheCreationInputTokens = asTokenCount(
    usage?.cache_creation_input_tokens,
  )
  const cacheReadInputTokens = asTokenCount(usage?.cache_read_input_tokens)

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
    cacheCreationInputTokens,
    cacheReadInputTokens,
    estimatedCostUsd: estimateLlmCostUsd(input.model, usage),
    terminalStatus: input.terminalStatus,
  })
}
