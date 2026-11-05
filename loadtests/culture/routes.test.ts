/** In-memory PostgREST fixture for harness verification only, never a database capacity benchmark. */
import { createServer } from "node:http"
import { randomUUID } from "node:crypto"
import { expect, it, vi } from "vitest"
import { listen, close, startSimulatedAi } from "./simulated-ai"
import { configureIsolatedEnvironment, installFetchGuard } from "./safety"
import { createFixture } from "./fixture"
import { runWorkload } from "./workload"

vi.mock("@/lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

it.each([2, 100, 200])("verifies %i concurrent culture sessions through real routes with synthetic database and AI", async users => {
  vi.resetModules()
  const tables = new Map<string, Array<Record<string, unknown>>>()
  let sequence = 0
  const database = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://127.0.0.1")
    const table = url.pathname.split("/").at(-1)!
    const all = tables.get(table) ?? []
    tables.set(table, all)
    const filters = [...url.searchParams].filter(([key]) => !["select", "order", "limit"].includes(key))
    const matches = (row: Record<string, unknown>) => filters.every(([key, value]) => {
      if (value === "is.null") return row[key] == null
      if (value.startsWith("eq.")) return String(row[key]) === value.slice(3)
      return false
    })
    let rows = all.filter(matches)
    let text = ""
    for await (const chunk of req) text += chunk
    if (req.method === "POST") {
      const body = JSON.parse(text)
      rows = (Array.isArray(body) ? body : [body]).map(value => ({ id: randomUUID(), status: "active", sent_at: ++sequence, created_at: sequence, ...value }))
      all.push(...rows)
    } else if (req.method === "PATCH") {
      for (const row of rows) Object.assign(row, JSON.parse(text))
    } else if (req.method === "DELETE") {
      if (table === "organisations") {
        const projectIds = (tables.get("projects") ?? []).filter(row => rows.some(org => org.id === row.organisation_id)).map(row => row.id)
        for (const [name, entries] of tables) {
          if (name !== "personas") tables.set(name, entries.filter(row => !projectIds.includes(row.project_id) && !rows.some(org => row.organisation_id === org.id)))
        }
      }
      tables.set(table, all.filter(row => !rows.includes(row)))
      res.writeHead(204).end(); return
    }
    const count = rows.length
    const order = url.searchParams.get("order")
    if (order) { const [key, direction] = order.split("."); rows = [...rows].sort((a, b) => (Number(a[key]) - Number(b[key])) * (direction === "desc" ? -1 : 1)) }
    if (url.searchParams.has("limit")) rows = rows.slice(0, Number(url.searchParams.get("limit")))
    res.setHeader("Content-Type", "application/json")
    res.setHeader("Content-Range", `0-${Math.max(0, count - 1)}/${count}`)
    if (req.method === "HEAD") { res.end(); return }
    const single = req.headers.accept?.includes("application/vnd.pgrst.object+json")
    res.end(JSON.stringify(single ? rows[0] ?? null : rows))
  })
  const databaseUrl = await listen(database)
  const ai = await startSimulatedAi({ delayMs: 5, jitterMs: 5 })
  const originalEnv = { ...process.env }
  configureIsolatedEnvironment(databaseUrl, "local-synthetic-service-key", ai.url, 100000)
  let guard = installFetchGuard([databaseUrl, ai.url])
  let fixture: Awaited<ReturnType<typeof createFixture>> | undefined
  let app: Awaited<ReturnType<typeof import("./application-server").startApplicationServer>> | undefined
  try {
    fixture = await createFixture(databaseUrl, "local-synthetic-service-key")
    const { startApplicationServer } = await import("./application-server")
    app = await startApplicationServer()
    guard.restore()
    guard = installFetchGuard([databaseUrl, ai.url, app.url])
    const result = await runWorkload(app.url, fixture.apiKey, { users, durationSeconds: 0, rampSeconds: 0, thinkMs: 0, requestTimeoutMs: 10000 })
    expect(result.failures).toEqual([])
    expect(result).toMatchObject({ started: users, completed: users, failed: 0, successfulTurns: users * 6, resumeChecks: users })
    expect(await fixture.verify()).toEqual({ sessions: users, completed: users, userMessages: users * 6, assistantMessages: users * 7, completionJobs: 0 })
    expect(ai.stats).toMatchObject({ requests: users * 6, rejected: 0, active: 0 })
    expect(guard.blocked).toEqual([])
    await fixture.cleanup()
    fixture = undefined
    expect([...tables.values()].flat()).toEqual([])
  } finally {
    if (app) await app.close()
    if (fixture) await fixture.cleanup()
    guard.restore()
    await ai.close()
    await close(database)
    process.env = originalEnv
  }
}, 30000)
