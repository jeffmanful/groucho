import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"

export type WorkloadOptions = {
  users: number; durationSeconds: number; rampSeconds: number; thinkMs: number; requestTimeoutMs: number
}
const answers = [
  "A gig",
  "Kitchen Light stayed with me because it captures friends looking out for each other after a hard night.",
  "I enjoy jazz gigs, record shops and making posters for local events.",
  "A friend who loves live music", "Lewisham", "London, Sat 17 Apr",
]
export function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? Math.round(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]) : null
}

export async function runWorkload(baseUrl: string, apiKey: string, options: WorkloadOptions) {
  const stats = { attempts: 0, started: 0, completed: 0, failed: 0, requests: 0, errors: 0, throttled: 0,
    successfulTurns: 0, resumeChecks: 0, active: 0, peakActive: 0 }
  const latencies: Record<string, number[]> = { start: [], message: [], resume: [], conversation: [] }
  const failures: Array<{ step: string; status: number; error: string }> = []
  const runId = randomUUID().replaceAll("-", "")
  const began = Date.now(), deadline = began + options.durationSeconds * 1000
  async function post(sessionId: string, endpoint: string, body: object, step: string) {
    const start = Date.now()
    stats.requests++
    let status = 0
    try {
      const response = await fetch(`${baseUrl}/v1/sessions/${sessionId}/${endpoint}`, {
        method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "User-Agent": "Groucho-Synthetic-Load-Test" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(options.requestTimeoutMs),
      })
      status = response.status
      const result = await response.json() as Record<string, unknown>
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Request rejected")
      latencies[step].push(Date.now() - start)
      return result
    } catch (error) {
      stats.errors++
      if (status === 429) stats.throttled++
      if (failures.length < 20) failures.push({ step, status, error: error instanceof Error ? error.message : String(error) })
      return null
    }
  }
  await Promise.all(Array.from({ length: options.users }, async (_, index) => {
    await delay(options.users > 1 ? options.rampSeconds * 1000 * index / (options.users - 1) : 0)
    let iteration = 0
    // Zero duration means one complete conversation per user, useful for a synchronized burst.
    do {
      const sessionId = `load_${runId}_${index}_${iteration++}`
      const applicant = { email: `load-${runId}-${index}-${iteration}@example.invalid`, name: `Synthetic applicant ${index}` }
      const conversationStarted = Date.now()
      stats.attempts++; stats.active++
      stats.peakActive = Math.max(stats.peakActive, stats.active)
      let completed = false
      try {
        let result = await post(sessionId, "start", { applicant }, "start")
        if (!result) { await delay(Math.max(1000, options.thinkMs)); continue }
        if (result.status !== "active" || typeof result.message !== "string") throw new Error("Invalid opening response")
        stats.started++
        for (let turn = 0; turn < answers.length; turn++) {
          await delay(options.thinkMs * (0.75 + Math.random() * 0.5))
          result = await post(sessionId, "messages", { message: answers[turn], applicant }, "message")
          if (!result) break
          stats.successfulTurns++
          if (result.engine !== "groucho_conversation_v1" || result.profile !== "lewisham-social") throw new Error("Unexpected culture runtime")
          if (result.status === "completed") {
            if (turn !== 5 || (result.completion as { complete?: boolean } | undefined)?.complete !== true || result.reviewStatus !== "not_required" || result.secret) {
              throw new Error("Unexpected synthetic completion or missing captured details")
            }
            completed = true
            break
          }
          if (result.status !== "active" || typeof result.message !== "string") throw new Error("Invalid active response")
          if (turn === 1) {
            const resumed = await post(sessionId, "start", { applicant }, "resume")
            if (!resumed) break
            if (resumed.resumed !== true || resumed.message !== result.message) throw new Error("Session resume lost progress")
            stats.resumeChecks++
          }
        }
        if (completed) { stats.completed++; latencies.conversation.push(Date.now() - conversationStarted) }
      } catch (error) {
        stats.errors++
        if (failures.length < 20) failures.push({ step: "contract", status: 200, error: error instanceof Error ? error.message : String(error) })
      } finally {
        stats.active--
        if (!completed) stats.failed++
      }
      // Prevent rapid rejection loops when testing the normal rate limit.
      if (!completed) await delay(Math.max(1000, options.thinkMs))
    } while (Date.now() < deadline)
  }))
  return { ...stats, elapsedSeconds: Number(((Date.now() - began) / 1000).toFixed(2)), failures,
    latencyMs: Object.fromEntries(Object.entries(latencies).map(([key, values]) => [key, {
      samples: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95), p99: percentile(values, 0.99),
    }])) }
}
