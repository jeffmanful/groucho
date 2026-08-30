import Anthropic from "@anthropic-ai/sdk"
import {
  DEFAULT_LOW_COST_ANTHROPIC_MODEL,
  logLlmUsage,
  modelFromEnv,
} from "@/lib/llm-usage"
import { log } from "@/lib/logger"
import { supabase } from "@/lib/supabase"
import {
  aggregateCulturalSignalEvents,
  CULTURAL_SIGNAL_TYPES,
  culturalSignalsFromMessageMetadata,
  normaliseCulturalSignals,
  parseCulturalSignalsSettings,
  type CulturalSignal,
  type CulturalSignalEvent,
  type CulturalSignalSnapshot,
} from "@/lib/cultural-signal-contract"

const CULTURAL_SIGNAL_EXTRACTION_MODEL_ENV =
  "GROUCHO_CULTURAL_SIGNAL_EXTRACTION_MODEL"

type CulturalSignalSourceMessage = {
  id: string
  role: "user" | "assistant"
  content?: string
  metadata?: unknown
}

export type ExtractedCulturalSignal = {
  sourceMessageId: string
  signal: CulturalSignal
}

let anthropicClient: Anthropic | null = null

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) anthropicClient = new Anthropic()
  return anthropicClient
}

function culturalSignalExtractionSchema(sourceMessageIds: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      signals: {
        type: "array",
        maxItems: 24,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            sourceMessageId: { type: "string", enum: sourceMessageIds },
            type: { type: "string", enum: CULTURAL_SIGNAL_TYPES },
            displayLabel: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: [
            "sourceMessageId",
            "type",
            "displayLabel",
            "confidence",
          ],
        },
      },
    },
    required: ["signals"],
  } as const
}

const CULTURAL_SIGNAL_EXTRACTION_SYSTEM = `You extract privacy-safe, project-level cultural signals from completed application conversations.

Return only signals explicitly present in an applicant message. Never infer identity, protected traits, health, politics, religion, sexuality, precise location, contact details, or socioeconomic status. Never return quotes, stories, sentences, names of applicants, or personal descriptions.

Use artist_reference, creative_discipline, and scene_or_genre only for short explicit cultural references. Use fixed thematic types only when directly supported. Use emerging_theme sparingly for a short reusable theme that does not fit another type. Keep displayLabel to eight words or fewer. Return no more than four signals per source message and an empty array when nothing is safe and useful.`

export async function extractCompletedSessionCulturalSignals(input: {
  organisationId: string
  projectId: string
  sessionId: string
  messages: CulturalSignalSourceMessage[]
}): Promise<ExtractedCulturalSignal[]> {
  const userMessages = input.messages
    .filter(
      (message) =>
        message.role === "user" &&
        typeof message.content === "string" &&
        message.content.trim().length > 0,
    )
    .map((message) => ({
      id: message.id,
      content: message.content!.trim(),
    }))
  if (!userMessages.length) return []

  const sourceMessageIds = userMessages.map((message) => message.id)
  const sourceMessageIdSet = new Set(sourceMessageIds)
  const model = modelFromEnv(
    CULTURAL_SIGNAL_EXTRACTION_MODEL_ENV,
    DEFAULT_LOW_COST_ANTHROPIC_MODEL,
  )

  try {
    const response = await getAnthropicClient().messages.create({
      model,
      max_tokens: 768,
      system: CULTURAL_SIGNAL_EXTRACTION_SYSTEM,
      output_config: {
        format: {
          type: "json_schema",
          schema: culturalSignalExtractionSchema(sourceMessageIds),
        },
      },
      messages: [
        {
          role: "user",
          content: JSON.stringify({ messages: userMessages }),
        },
      ],
    })
    logLlmUsage({
      operation: "cultural_signal_extraction",
      provider: "anthropic",
      model,
      usage: response.usage,
      organisationId: input.organisationId,
      projectId: input.projectId,
      sessionId: input.sessionId,
    })

    if (response.stop_reason === "max_tokens") {
      throw new Error("Cultural-signal extraction reached its token limit")
    }
    if (response.stop_reason === "refusal") {
      log.info("cultural_signal_extraction_refused", {
        projectId: input.projectId,
        sessionId: input.sessionId,
      })
      return []
    }
    const textBlock = response.content.find((block) => block.type === "text")
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Cultural-signal extraction returned no text")
    }

    const parsed = JSON.parse(textBlock.text) as { signals?: unknown }
    if (!Array.isArray(parsed.signals)) return []
    const extracted: ExtractedCulturalSignal[] = []
    for (const raw of parsed.signals) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue
      const value = raw as Record<string, unknown>
      if (
        typeof value.sourceMessageId !== "string" ||
        !sourceMessageIdSet.has(value.sourceMessageId)
      ) {
        continue
      }
      const [signal] = normaliseCulturalSignals([value])
      if (signal) {
        extracted.push({ sourceMessageId: value.sourceMessageId, signal })
      }
    }
    return extracted
  } catch (error) {
    log.error("cultural_signal_extraction_failed", {
      projectId: input.projectId,
      sessionId: input.sessionId,
      detail: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export async function recordCompletedSessionCulturalSignals(input: {
  organisationId: string
  projectId: string
  sessionId: string
  settings: unknown
  likelyBot: boolean
  messages: CulturalSignalSourceMessage[]
}): Promise<void> {
  const settings = parseCulturalSignalsSettings(input.settings)
  if (!settings.enabled || input.likelyBot) return
  const metadataSignals = input.messages.flatMap((message) => message.role !== "user" ? [] :
    culturalSignalsFromMessageMetadata(message.metadata).map((signal) => ({
      sourceMessageId: message.id,
      signal,
    })))
  const sourceIdsWithMetadataSignals = new Set(
    metadataSignals.map((item) => item.sourceMessageId),
  )
  const extractedSignals = await extractCompletedSessionCulturalSignals({
    organisationId: input.organisationId,
    projectId: input.projectId,
    sessionId: input.sessionId,
    messages: input.messages.filter(
      (message) => !sourceIdsWithMetadataSignals.has(message.id),
    ),
  })
  const uniqueSignals = new Map<string, ExtractedCulturalSignal>()
  for (const item of [...metadataSignals, ...extractedSignals]) {
    uniqueSignals.set(
      `${item.sourceMessageId}:${item.signal.type}:${item.signal.normalizedKey}`,
      item,
    )
  }
  const events = [...uniqueSignals.values()].map(({ sourceMessageId, signal }) => ({
      organisation_id: input.organisationId,
      project_id: input.projectId,
      session_id: input.sessionId,
      source_message_id: sourceMessageId,
      signal_type: signal.type,
      normalized_key: signal.normalizedKey,
      display_label: signal.displayLabel,
      confidence: signal.confidence,
      is_sensitive: signal.isSensitive,
    }))
  if (!events.length) return

  const { error } = await supabase.from("cultural_signal_events").upsert(events, {
    onConflict: "source_message_id,signal_type,normalized_key",
    ignoreDuplicates: true,
  })
  if (error) throw error

  const definitions = events.filter((event) => event.signal_type === "emerging_theme").map((event) => ({
    organisation_id: event.organisation_id,
    project_id: event.project_id,
    signal_type: "emerging_theme",
    normalized_key: event.normalized_key,
    display_label: event.display_label,
    status: "pending",
  }))
  if (!definitions.length) return
  const { error: definitionError } = await supabase.from("cultural_signal_definitions").upsert(definitions, {
    onConflict: "project_id,signal_type,normalized_key",
    ignoreDuplicates: true,
  })
  if (definitionError) throw definitionError
}

export async function rebuildCulturalSignalSnapshot(input: {
  organisationId: string
  projectId: string
  settings: unknown
}): Promise<CulturalSignalSnapshot> {
  const settings = parseCulturalSignalsSettings(input.settings)
  const cutoff = new Date(Date.now() - settings.windowDays * 86400000).toISOString()
  const [{ data: events, error: eventError }, { data: definitions, error: definitionError }] = await Promise.all([
    supabase.from("cultural_signal_events")
      .select("session_id, signal_type, normalized_key, display_label, is_sensitive, created_at")
      .eq("organisation_id", input.organisationId).eq("project_id", input.projectId).gte("created_at", cutoff),
    supabase.from("cultural_signal_definitions").select("normalized_key, status")
      .eq("organisation_id", input.organisationId).eq("project_id", input.projectId),
  ])
  if (eventError) throw eventError
  if (definitionError) throw definitionError
  const definitionsRows = definitions ?? []
  const aggregate = aggregateCulturalSignalEvents({
    events: (events ?? []) as CulturalSignalEvent[],
    approvedEmergingKeys: new Set(definitionsRows.filter((row) => row.status === "approved").map((row) => row.normalized_key)),
    pendingEmergingKeys: new Set(definitionsRows.filter((row) => row.status === "pending").map((row) => row.normalized_key)),
    minimumSessions: settings.minimumSessions,
    sensitiveMinimumSessions: settings.sensitiveMinimumSessions,
  })
  const generatedAt = new Date().toISOString()
  const snapshot: CulturalSignalSnapshot = {
    version: Date.now(), generatedAt, windowDays: settings.windowDays,
    eligibleSessionCount: aggregate.eligibleSessionCount,
    signals: aggregate.signals, pendingEmergingSignals: aggregate.pendingEmergingSignals,
  }
  const { error: insertError } = await supabase.from("cultural_signal_snapshots").insert({
    organisation_id: input.organisationId, project_id: input.projectId,
    version: snapshot.version, window_days: settings.windowDays,
    minimum_sessions: settings.minimumSessions,
    sensitive_minimum_sessions: settings.sensitiveMinimumSessions,
    eligible_session_count: snapshot.eligibleSessionCount, payload: snapshot, generated_at: generatedAt,
  })
  if (insertError) throw insertError
  const { error: stateError } = await supabase.from("cultural_signal_project_state").upsert({
    organisation_id: input.organisationId, project_id: input.projectId,
    snapshot_dirty: false, updated_at: generatedAt,
  }, { onConflict: "project_id" })
  if (stateError) throw stateError
  return snapshot
}

export async function getCulturalSignalSnapshot(input: {
  organisationId: string
  projectId: string
  settings: unknown
  forceRebuild?: boolean
}): Promise<CulturalSignalSnapshot> {
  const [stateResult, latestResult] = await Promise.all([
    supabase.from("cultural_signal_project_state").select("snapshot_dirty")
      .eq("organisation_id", input.organisationId).eq("project_id", input.projectId).maybeSingle(),
    supabase.from("cultural_signal_snapshots").select("payload")
      .eq("organisation_id", input.organisationId).eq("project_id", input.projectId)
      .order("generated_at", { ascending: false }).limit(1).maybeSingle(),
  ])
  if (stateResult.error) throw stateResult.error
  if (latestResult.error) throw latestResult.error
  if (!input.forceRebuild && stateResult.data?.snapshot_dirty === false && latestResult.data?.payload) {
    return latestResult.data.payload as CulturalSignalSnapshot
  }
  return rebuildCulturalSignalSnapshot(input)
}
