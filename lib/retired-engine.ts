/**
 * The original gatekeeper engine is retired. Projects with no `conversation_engine` setting can
 * no longer start or continue conversations; they need reconfiguring in the project wizard.
 * Old sessions and their stored reports stay readable.
 *
 * Set GROUCHO_LEGACY_ENGINE=enabled to turn the engine back on while the retirement settles.
 */
export const RETIRED_ENGINE_CODE = "engine_retired"
export const RETIRED_ENGINE_ERROR = "This project uses Groucho's retired conversation engine. Reconfigure it in the project wizard to start new conversations."

export function legacyEngineEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.GROUCHO_LEGACY_ENGINE?.trim() === "enabled"
}

/** A gatekeeper project with no engine setting, which only the retired engine could run. */
export function usesRetiredEngine(rawSettings: unknown): boolean {
  if (!rawSettings || typeof rawSettings !== "object" || Array.isArray(rawSettings)) return true
  const settings = rawSettings as Record<string, unknown>
  const type = typeof settings.project_type === "string" ? settings.project_type : "gatekeeper"
  return type === "gatekeeper" && !(typeof settings.conversation_engine === "string" && settings.conversation_engine.trim())
}

export const retiredEngineBody = { error: RETIRED_ENGINE_ERROR, code: RETIRED_ENGINE_CODE } as const
