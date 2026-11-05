import { randomUUID, createHash } from "node:crypto"
import { databaseTarget } from "./safety"
import { LEWISHAM_SOCIAL_PERSONA_PROMPT } from "../../lib/lewisham-social-persona"

export async function createFixture(databaseUrl: string, serviceKey: string, stagingRef?: string) {
  const origin = databaseTarget(databaseUrl, stagingRef).origin
  const id = randomUUID()
  const apiKey = `gk_test_load_${randomUUID().replaceAll("-", "")}`
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=representation" }
  async function request(table: string, method: string, body?: unknown, query = "") {
    const response = await fetch(`${origin}/rest/v1/${table}${query}`, { method, headers, signal: AbortSignal.timeout(30000), body: body === undefined ? undefined : JSON.stringify(body) })
    if (!response.ok) throw new Error(`Test fixture ${method} ${table} failed (${response.status}); verify test migrations and service key`)
    return response.status === 204 ? null : response.json()
  }
  const orgId = randomUUID(), projectId = randomUUID(), personaId = randomUUID()
  let orgCreated = false, personaCreated = false
  async function cleanup() {
    // All identifiers were generated for this run. Never delete or reconfigure an existing project.
    if (orgCreated) await request("organisations", "DELETE", undefined, `?id=eq.${orgId}`)
    if (personaCreated) await request("personas", "DELETE", undefined, `?id=eq.${personaId}`)
  }
  try {
    await request("organisations", "POST", { id: orgId, name: "Synthetic culture load test", slug: `loadtest-${id}` })
    orgCreated = true
    await request("personas", "POST", { id: personaId, name: "Mo synthetic load fixture", slug: `loadtest-${id}`,
      prompt: LEWISHAM_SOCIAL_PERSONA_PROMPT,
      is_active: true, is_default: false, owner_organisation_id: orgId })
    personaCreated = true
    await request("projects", "POST", { id: projectId, organisation_id: orgId, name: "Culture load test", slug: "culture-load-test",
      settings: { environment: "test", session_mode: "dry-run", project_type: "gatekeeper", conversation_engine: "conversation_v1",
        conversation_profile: "lewisham-social", persona_id: personaId } })
    await request("api_keys", "POST", { organisation_id: orgId, project_id: projectId,
      key_hash: createHash("sha256").update(apiKey).digest("hex"), key_prefix: apiKey.slice(0, 12), label: "Synthetic load test", scopes: ["conversations"] })
    async function count(table: string, extra = "") {
      const response = await fetch(`${origin}/rest/v1/${table}?project_id=eq.${projectId}&select=id${extra}`, {
        method: "HEAD", signal: AbortSignal.timeout(30000), headers: { ...headers, Prefer: "count=exact" },
      })
      if (!response.ok) throw new Error(`Could not verify test ${table}`)
      const total = response.headers.get("content-range")?.split("/").at(-1)
      if (!total || total === "*") throw new Error(`Missing exact row count for ${table}`)
      return Number(total)
    }
    return { apiKey, projectId, cleanup, async verify() {
      return { sessions: await count("sessions"), completed: await count("sessions", "&status=eq.completed"),
        userMessages: await count("messages", "&role=eq.user"), assistantMessages: await count("messages", "&role=eq.assistant"),
        completionJobs: await count("session_completion_jobs") }
    } }
  } catch (error) {
    await cleanup().catch(() => {})
    throw error
  }
}
