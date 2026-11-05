import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { parseArgs } from "node:util"
import { configureIsolatedEnvironment, installFetchGuard, databaseTarget } from "./safety"
import { startSimulatedAi } from "./simulated-ai"
import { createFixture } from "./fixture"
import { runWorkload } from "./workload"

const numericOptions = {
  users: { type: "string" }, duration: { type: "string" }, ramp: { type: "string" },
  "think-ms": { type: "string" }, "ai-delay-ms": { type: "string" },
  "ai-jitter-ms": { type: "string" }, "rate-limit": { type: "string" },
} as const
const { values } = parseArgs({ options: { staging: { type: "boolean" }, ...numericOptions }, strict: true, allowPositionals: false })

function numberArg(name: keyof typeof numericOptions, fallback: number, max: number, min = 0) {
  const value = values[name] === undefined ? fallback : Number(values[name])
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`--${name} must be an integer from ${min} to ${max}`)
  return value
}
async function main() {
  const stagingRef = values.staging ? process.env.LOADTEST_STAGING_PROJECT_REF : undefined
  if (values.staging && !stagingRef) throw new Error("Staging requires LOADTEST_STAGING_PROJECT_REF for an isolated database branch")
  if (values.staging && !process.env.LOADTEST_SUPABASE_URL) throw new Error("Staging requires an explicit LOADTEST_SUPABASE_URL")
  const databaseUrl = databaseTarget(process.env.LOADTEST_SUPABASE_URL ?? "http://127.0.0.1:54321", stagingRef).origin
  const serviceKey = process.env.LOADTEST_SUPABASE_SERVICE_KEY
  if (!serviceKey) throw new Error("Set LOADTEST_SUPABASE_SERVICE_KEY to your isolated test database service key. Application .env files are deliberately not loaded.")
  const options = {
    users: numberArg("users", 100, 500, 1), durationSeconds: numberArg("duration", 0, 3600),
    rampSeconds: numberArg("ramp", 20, 300), thinkMs: numberArg("think-ms", 3000, 60000),
    requestTimeoutMs: 60000,
  }
  const aiOptions = { delayMs: numberArg("ai-delay-ms", 1500, 30000), jitterMs: numberArg("ai-jitter-ms", 500, 10000) }
  const rateLimit = numberArg("rate-limit", 100000, 1000000, 1)
  const ai = await startSimulatedAi(aiOptions)
  configureIsolatedEnvironment(databaseUrl, serviceKey, ai.url, rateLimit, stagingRef)
  const guard = installFetchGuard([databaseUrl, ai.url], stagingRef)
  let fixture: Awaited<ReturnType<typeof createFixture>> | undefined
  let app: Awaited<ReturnType<typeof import("./application-server").startApplicationServer>> | undefined
  let clientGuard: ReturnType<typeof installFetchGuard> | undefined
  try {
    fixture = await createFixture(databaseUrl, serviceKey, stagingRef)
    // Import only after dummy credentials and egress restrictions are in place.
    const { startApplicationServer } = await import("./application-server")
    app = await startApplicationServer()
    // Replace rather than nest guards, admitting only our newly created loopback HTTP server.
    guard.restore()
    clientGuard = installFetchGuard([databaseUrl, ai.url, app.url], stagingRef)
    console.log(`Culture flow: ${options.users} applicants; simulated AI; ${stagingRef ? "hosted staging" : "local"} database; API-key limit ${rateLimit}/minute.`)
    const results = await runWorkload(app.url, fixture.apiKey, options)
    const persisted = await fixture.verify()
    const blocked = [...guard.blocked, ...clientGuard.blocked]
    const integrity = persisted.completed === results.completed && persisted.sessions === results.started &&
      persisted.userMessages === results.successfulTurns && persisted.assistantMessages === results.started + results.successfulTurns && persisted.completionJobs === 0
    const passed = results.completed > 0 && results.failed === 0 && results.errors === 0 && integrity && blocked.length === 0 && ai.stats.rejected === 0
    const report = { generatedAt: new Date().toISOString(), scope: "Actual culture API handlers and isolated Supabase; synthetic AI; excludes Next hosting, browser, edge and real provider capacity",
      databaseMode: stagingRef ? "hosted-staging" : "local", options, aiOptions, rateLimit, projectId: fixture.projectId, results, persisted, simulatedAi: ai.stats,
      blockedEgress: blocked, integrity, passed }
    const directory = resolve("loadtests/results")
    await mkdir(directory, { recursive: true })
    const path = resolve(directory, `culture-${Date.now()}-${options.users}.json`)
    await writeFile(path, JSON.stringify(report, null, 2) + "\n")
    console.log(JSON.stringify({ passed, ...results, persisted, simulatedAi: ai.stats, report: path }, null, 2))
    if (!passed) process.exitCode = 1
  } finally {
    const errors: string[] = []
    try { if (app) await app.close() } catch { errors.push("HTTP server shutdown failed") }
    // No reuse of production data; cleanup only the generated fixture's organisation/persona.
    try { if (fixture) await fixture.cleanup() } catch { errors.push("Test fixture cleanup failed") }
    clientGuard?.restore()
    guard.restore()
    try { await ai.close() } catch { errors.push("Synthetic AI shutdown failed") }
    if (errors.length) throw new Error(errors.join("; "))
  }
}
main().catch(error => {
  // Do not dump request headers, SDK errors or environment variables containing service keys.
  console.error(error instanceof Error ? error.message : "Culture load test failed")
  process.exitCode = 1
})
