import { mkdirSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { expect, it, vi } from "vitest"
import { fixtures } from "./fixtures"

const capture = vi.hoisted(() => ({ request: null as unknown }))
vi.mock("@anthropic-ai/sdk", () => ({ default: class {
  messages = { create: async (request: unknown) => {
    capture.request = request
    return { content: [{ type: "text", text: '{"core":{},"signals":[]}' }], stop_reason: "end_turn", usage: {} }
  } }
} }))
vi.mock("@/lib/llm-usage", () => ({
  DEFAULT_LOW_COST_ANTHROPIC_MODEL: "claude-haiku-4-5-20251001",
  modelFromEnv: (_key: string, fallback: string) => fallback,
  logLlmUsage: async () => {},
}))
vi.mock("@/lib/supabase", () => ({ supabase: new Proxy({}, { get() { throw new Error("Database access forbidden in benchmark") } }) }))
vi.mock("@/lib/logger", () => ({ log: { info() {}, warn() {}, error() {} } }))
import { extractProfile } from "@/lib/profile-extraction"
import { extractCompletedSessionCulturalSignals } from "@/lib/cultural-signals"

it("captures actual production requests without API or database access", async () => {
  const requests: unknown[] = []
  for (const fixture of fixtures) {
    const transcript = fixture.turns.flatMap(([question, answer], index) => [
      { id: `${index}-assistant`, role: "assistant" as const, content: question },
      { id: `${index}-user`, role: "user" as const, content: answer },
    ])
    for (const task of ["profile", "cultural"] as const) {
      capture.request = null
      if (task === "profile") await extractProfile({ transcript, persona: null })
      else await extractCompletedSessionCulturalSignals({ organisationId: "synthetic", projectId: "synthetic", sessionId: fixture.id, messages: transcript })
      expect(capture.request).not.toBeNull()
      requests.push({ fixture: fixture.id, task, review: fixture.review, transcript, request: capture.request,
        sha256: createHash("sha256").update(JSON.stringify(capture.request)).digest("hex") })
    }
  }
  mkdirSync("evals/background-models/artifacts", { recursive: true })
  writeFileSync("evals/background-models/artifacts/requests.json", JSON.stringify(requests, null, 2) + "\n")
  expect(requests).toHaveLength(12)
})
