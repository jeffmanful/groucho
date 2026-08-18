import { supabase } from "@/lib/supabase"
import {
  aggregateCulturalSignalEvents,
  culturalSignalsFromMessageMetadata,
  parseCulturalSignalsSettings,
  type CulturalSignalEvent,
  type CulturalSignalSnapshot,
} from "@/lib/cultural-signal-contract"

export async function recordCompletedSessionCulturalSignals(input: {
  organisationId: string
  projectId: string
  sessionId: string
  settings: unknown
  likelyBot: boolean
  messages: Array<{ id: string; role: "user" | "assistant"; metadata?: unknown }>
}): Promise<void> {
  const settings = parseCulturalSignalsSettings(input.settings)
  if (!settings.enabled || input.likelyBot) return
  const events = input.messages.flatMap((message) => message.role !== "user" ? [] :
    culturalSignalsFromMessageMetadata(message.metadata).map((signal) => ({
      organisation_id: input.organisationId,
      project_id: input.projectId,
      session_id: input.sessionId,
      source_message_id: message.id,
      signal_type: signal.type,
      normalized_key: signal.normalizedKey,
      display_label: signal.displayLabel,
      confidence: signal.confidence,
      is_sensitive: signal.isSensitive,
    })))
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
