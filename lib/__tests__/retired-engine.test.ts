import { afterEach, describe, expect, it, vi } from "vitest"
import { legacyEngineEnabled, RETIRED_ENGINE_CODE, usesRetiredEngine } from "@/lib/retired-engine"

vi.mock("@/lib/supabase", () => ({ supabase: { from: (table: string) => { throw new Error(`Unexpected database access: ${table}`) } } }))
vi.mock("@/lib/logger", () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }))
vi.mock("@/lib/project-resolution", async importOriginal => ({
  ...await importOriginal<object>(),
  resolveProjectContext: async () => ({ ok: true, context: { organisationId: "org", projectId: "project", apiKeyId: "key", settings: (await import("@/lib/project-settings")).normalizeProjectSettings({ persona_id: "p" }) } }),
  touchApiKeyLastUsed: () => {},
}))
vi.mock("@/lib/colors-engine-routing", async importOriginal => ({ ...await importOriginal<object>(), colorsEngineRoute: async () => "standard" }))

import { startGatekeeperSession } from "@/lib/start-gatekeeper-session"
import { postSessionMessage } from "@/lib/post-session-message"
import { normalizeProjectSettings } from "@/lib/project-settings"

describe("retired engine", () => {
  afterEach(() => { delete process.env.GROUCHO_LEGACY_ENGINE })

  it("identifies only gatekeeper projects with no engine as retired", () => {
    expect(usesRetiredEngine({ persona_id: "p" })).toBe(true)
    expect(usesRetiredEngine({ project_type: "gatekeeper" })).toBe(true)
    expect(usesRetiredEngine({ conversation_engine: "conversation_v1", conversation_profile: "project" })).toBe(false)
    expect(usesRetiredEngine({ conversation_engine: "colors_forum" })).toBe(false)
    expect(usesRetiredEngine({ project_type: "onboarding" })).toBe(false)
    expect(usesRetiredEngine({ project_type: "ticket_access" })).toBe(false)
  })

  it("stays off unless explicitly enabled", () => {
    expect(legacyEngineEnabled({})).toBe(false)
    expect(legacyEngineEnabled({ GROUCHO_LEGACY_ENGINE: "true" })).toBe(false)
    expect(legacyEngineEnabled({ GROUCHO_LEGACY_ENGINE: "enabled" })).toBe(true)
  })

  it("refuses to start a session on a retired project without touching the database", async () => {
    const response = await startGatekeeperSession({
      sessionId: "session-retired-1",
      context: { organisationId: "org", projectId: "project", apiKeyId: null, settings: normalizeProjectSettings({ persona_id: "p" }) },
      projectSettings: normalizeProjectSettings({ persona_id: "p" }),
    } as Parameters<typeof startGatekeeperSession>[0])
    expect(response.status).toBe(410)
    expect(await response.json()).toMatchObject({ code: RETIRED_ENGINE_CODE })
  })

  it("refuses a message that would reach the retired engine", async () => {
    const response = await postSessionMessage({ authorization: "Bearer test", sessionId: "session-retired-2", message: "Hello there" } as Parameters<typeof postSessionMessage>[0])
    expect(response.status).toBe(410)
    expect(await response.json()).toMatchObject({ code: RETIRED_ENGINE_CODE })
  })
})
