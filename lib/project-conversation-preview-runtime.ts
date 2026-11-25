import { randomUUID } from "node:crypto"
import { postConversation, type ConversationTranscriptEntry } from "@/lib/conversation-engine"
import { projectConversationOpening, projectConversationSettings, type ProjectConversationConfig } from "@/lib/project-conversation-config"
import { projectConversationConfiguration, projectConversationProfile } from "@/lib/project-conversation-runtime"
import type { ProjectConversationPreview } from "@/lib/project-conversation-preview"
import { emptySignalEvidence } from "@/lib/project-conversation-evidence"
import { DEFAULT_INTERACTION_SPEC } from "@/lib/gatekeeper-interaction-spec"
import { normalizeProjectSettings } from "@/lib/project-settings"

export function startProjectPreview(config: ProjectConversationConfig, organisationId: string, actor: string, projectId?: string) {
  const runtime = projectConversationConfiguration(config, { organisationId, projectId: projectId ?? "preview" })
  const message = projectConversationOpening(config)
  const profile = projectConversationProfile(config)
  const choice = profile.openingChoice ? profile.choices[profile.openingChoice] : undefined
  const signalTurn = config.version === 2 && config.signals.length
    ? { questionSignalId: profile.openingSignalId ?? null, followUp: false, changes: [] }
    : undefined
  const ui = { ...DEFAULT_INTERACTION_SPEC, ...(choice ? { inputType: choice.inputType ?? "singleSelect", options: [...choice.options] } : {}) }
  const transcript: ConversationTranscriptEntry[] = [{ role: "assistant", content: message, metadata: {
    conversation_engine: runtime.marker, conversation_profile: runtime.id,
    ...(profile.openingChoice ? { conversation_choice_key: profile.openingChoice } : {}),
    ...(signalTurn ? { conversation_signal_turn: signalTurn } : {}), ui,
  } }]
  const preview: ProjectConversationPreview = {
    organisationId, ...(projectId ? { projectId } : {}), actor, expiresAt: Date.now() + 60 * 60_000,
    config, transcript, status: "active",
  }
  return { preview, visible: { message, status: preview.status, ui, ...(signalTurn ? { signalTurn } : {}),
    ...(config.version === 2 ? { signalEvidence: emptySignalEvidence(config.signals) } : {}) } }
}

export async function replyToProjectPreview(
  preview: ProjectConversationPreview,
  message: string,
  options: { onReplyDelta?: (text: string) => void; reviewAuthoredSettings?: boolean } = {},
) {
  const context = {
    organisationId: preview.organisationId, projectId: preview.projectId ?? "preview", apiKeyId: null,
    settings: normalizeProjectSettings(projectConversationSettings(preview.config)),
  }
  const response = await postConversation({
    configuration: projectConversationConfiguration(preview.config, context), context,
    sessionId: randomUUID(), message, previewTranscript: preview.transcript, runCompletion: false, ...options,
  })
  const result = await response.json()
  if (!response.ok) return { ok: false as const, body: result, status: response.status }
  const { previewTranscript, ...visible } = result
  const signalTurn = (previewTranscript as ConversationTranscriptEntry[]).at(-1)?.metadata.conversation_signal_turn
  return {
    ok: true as const,
    visible: { ...visible, ...(signalTurn ? { signalTurn } : {}) },
    preview: {
      ...preview, transcript: previewTranscript, status: result.status,
      settingsConflict: visible.settingsConflict ?? preview.settingsConflict,
    } satisfies ProjectConversationPreview,
  }
}
