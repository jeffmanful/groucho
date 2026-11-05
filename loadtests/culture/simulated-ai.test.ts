import { afterEach, describe, expect, it } from "vitest"
import Anthropic from "@anthropic-ai/sdk"
import { installFetchGuard, loopbackUrl, databaseTarget, PRODUCTION_SUPABASE_REF } from "./safety"
import { startSimulatedAi } from "./simulated-ai"

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); cleanups.length = 0 })

describe("load-test billing isolation", () => {
  it.each(["https://api.anthropic.com", "http://example.com", "http://localhost:54321", "http://127.0.0.1.evil.test", "http://user:secret@127.0.0.1", "http://127.0.0.1/path"])("rejects unsafe service URL %s", url => {
    expect(() => loopbackUrl(url)).toThrow()
  })
  it("allows only the explicitly selected staging database and rejects production", () => {
    const ref = "abcdefghijklmnopqrst"
    expect(databaseTarget(`https://${ref}.supabase.co`, ref).origin).toBe(`https://${ref}.supabase.co`)
    expect(() => databaseTarget(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`, PRODUCTION_SUPABASE_REF)).toThrow("never the live")
    expect(() => databaseTarget("https://wrong.supabase.co", ref)).toThrow("exactly match")
    expect(() => databaseTarget(`https://${ref}.supabase.co/other`, ref)).toThrow("exactly match")
    expect(() => databaseTarget(`https://${ref}.supabase.co`)).toThrow()
    const guard = installFetchGuard([`https://${ref}.supabase.co`], ref)
    cleanups.push(guard.restore)
  })
  it("blocks provider traffic and unrelated loopback ports before sending", async () => {
    const guard = installFetchGuard(["http://127.0.0.1:54321"])
    cleanups.push(guard.restore)
    await expect(fetch("https://api.anthropic.com/v1/messages")).rejects.toThrow("egress blocked")
    await expect(fetch("http://127.0.0.1:54322")).rejects.toThrow("egress blocked")
    expect(guard.blocked).toHaveLength(2)
  })
})

it("handles 200 simultaneous real SDK requests using only the synthetic provider", async () => {
  const provider = await startSimulatedAi({ delayMs: 10, jitterMs: 5 })
  cleanups.push(provider.close)
  const client = new Anthropic({ apiKey: "dummy", baseURL: provider.url, maxRetries: 0 })
  const result = await Promise.all(Array.from({ length: 200 }, () => client.messages.create({
    model: "claude-haiku-5-5", max_tokens: 600,
    messages: [{ role: "user", content: "A gig" }],
    tools: [{ name: "groucho_converse", input_schema: { type: "object" } }],
  })))
  expect(result).toHaveLength(200)
  expect(provider.stats.requests).toBe(200)
  expect(provider.stats.peakActive).toBeGreaterThan(1)
  expect(result[0].content[0]).toMatchObject({ type: "tool_use", input: { close: false, reply: "What stayed with you about their music?" } })
  expect(result.every(message => message.usage.input_tokens === 0 && message.usage.output_tokens === 0)).toBe(true)
})

it("supports SDK streaming for tool and structured JSON responses", async () => {
  const provider = await startSimulatedAi({ delayMs: 1, jitterMs: 0 })
  cleanups.push(provider.close)
  const client = new Anthropic({ apiKey: "dummy", baseURL: provider.url, maxRetries: 0 })
  for (const tool of [true, false]) {
    const stream = client.messages.stream({ model: "claude-haiku-5-5", max_tokens: 600,
      messages: [{ role: "user", content: "A gig" }],
      ...(tool ? { tools: [{ name: "groucho_converse", input_schema: { type: "object" as const } }] } : {}),
    })
    const message = await stream.finalMessage()
    expect(message.content[0]).toMatchObject({ type: tool ? "tool_use" : "text" })
    if (message.content[0].type === "text") expect(JSON.parse(message.content[0].text).reply).toContain("?")
  }
})
