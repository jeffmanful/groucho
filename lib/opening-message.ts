import {
  DEFAULT_INTERACTION_SPEC,
  type GrouchoInputType,
  type GrouchoInteractionSpec,
} from "@/lib/gatekeeper-interaction-spec"
import type { ApplicationOpeningInteraction } from "@/lib/project-settings"

export const MAX_OPENING_MESSAGE_LENGTH = 500
export const MAX_OPENING_INTERACTION_OPTIONS = 12

export type ParsedOpeningMessage =
  | { ok: true; value: string | undefined }
  | { ok: false; error: string }

export type ParsedOpeningInteraction =
  | { ok: true; value: GrouchoInteractionSpec | undefined }
  | { ok: false; error: string }

export function parseOpeningMessage(raw: unknown): ParsedOpeningMessage {
  if (raw === undefined || raw === null) {
    return { ok: true, value: undefined }
  }
  if (typeof raw !== "string") {
    return { ok: false, error: "openingMessage must be a string" }
  }
  const trimmed = raw.trim()
  if (!trimmed) {
    return { ok: false, error: "openingMessage must not be empty" }
  }
  if (trimmed.length > MAX_OPENING_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: `openingMessage must be at most ${MAX_OPENING_MESSAGE_LENGTH} characters`,
    }
  }
  return { ok: true, value: trimmed }
}

export function resolveGatekeeperOpeningMessage(
  clientOpening: string | undefined,
  projectOpening: string,
): string {
  return clientOpening?.trim() || projectOpening
}

function parseOpeningInputType(raw: unknown): GrouchoInputType | null {
  if (raw === "text" || raw === "singleSelect" || raw === "multiSelect") {
    return raw
  }
  return null
}

function parseOpeningOptions(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const options = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, MAX_OPENING_INTERACTION_OPTIONS)
  return options.length > 0 ? options : null
}

export function parseOpeningInteraction(raw: unknown): ParsedOpeningInteraction {
  if (raw === undefined || raw === null) {
    return { ok: true, value: undefined }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "openingInteraction must be an object" }
  }

  const data = raw as Record<string, unknown>
  const inputType = parseOpeningInputType(data.inputType)
  if (!inputType) {
    return {
      ok: false,
      error: "openingInteraction.inputType must be text, singleSelect, or multiSelect",
    }
  }

  const options =
    inputType === "singleSelect" || inputType === "multiSelect"
      ? parseOpeningOptions(data.options)
      : null
  if ((inputType === "singleSelect" || inputType === "multiSelect") && !options) {
    return {
      ok: false,
      error:
        "openingInteraction.options is required for singleSelect and multiSelect",
    }
  }

  return {
    ok: true,
    value: {
      ...DEFAULT_INTERACTION_SPEC,
      inputType,
      visualState: inputType === "text" ? "idle" : "curious",
      ...(options ? { options } : {}),
    },
  }
}

export function applicationOpeningInteractionToSpec(
  interaction: ApplicationOpeningInteraction | undefined,
): GrouchoInteractionSpec | undefined {
  if (!interaction) return undefined
  return {
    ...DEFAULT_INTERACTION_SPEC,
    inputType: interaction.inputType,
    visualState: interaction.inputType === "text" ? "idle" : "curious",
    ...(interaction.options?.length ? { options: interaction.options } : {}),
  }
}

export function resolveGatekeeperOpeningInteraction(
  clientInteraction: GrouchoInteractionSpec | undefined,
  projectInteraction?: ApplicationOpeningInteraction,
): GrouchoInteractionSpec {
  return (
    clientInteraction ??
    applicationOpeningInteractionToSpec(projectInteraction) ?? {
      ...DEFAULT_INTERACTION_SPEC,
      visualState: "idle",
    }
  )
}
