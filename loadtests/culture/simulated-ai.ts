import { createServer, type Server } from "node:http"
import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"

export async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve() })
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("No listening address")
  return `http://127.0.0.1:${address.port}`
}

export async function close(server: Server) {
  server.closeIdleConnections()
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}

type ModelRequest = {
  model: string
  stream?: boolean
  messages: Array<{ role: string; content: string }>
  tools?: Array<{ name: string }>
}

/** Protocol-compatible synthetic responses; no forwarding or paid-provider fallback exists. */
export function syntheticReply(request: ModelRequest) {
  if (request.tools?.some(tool => tool.name !== "groucho_converse")) throw new Error("Unsupported tool: refusing unrelated model work")
  const answers = request.messages.filter(message => message.role === "user")
  const turn = answers.length
  const answer = answers.at(-1)?.content ?? ""
  const keys = ["discovery", "connection", "otherInterests", "companion", "location", "night"]
  const questions = [
    "What stayed with you about their music?", "What other gigs or creative interests do you enjoy?",
    "Who would you bring along?", "Where would you be coming from?", "Which night would you prefer?",
  ]
  return {
    reply: turn >= 6 ? "Thanks for sharing your connection to live music." : questions[turn - 1] ?? questions[0],
    close: turn >= 6, boundary: "none", boundaryQuestion: "", addsNewContext: true,
    choiceKey: turn === 5 ? "night" : "none",
    facts: turn <= 6 ? [{ key: keys[turn - 1], value: answer, sourceQuote: answer }] : [],
  }
}

export async function startSimulatedAi(options: { delayMs: number; jitterMs: number }) {
  const stats = { requests: 0, active: 0, peakActive: 0, rejected: 0 }
  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/messages") {
      res.writeHead(404).end(); return
    }
    let counted = false
    try {
      let body = ""
      for await (const chunk of req) {
        body += chunk
        if (body.length > 1_000_000) throw new Error("Request too large")
      }
      const request = JSON.parse(body) as ModelRequest
      const reply = syntheticReply(request)
      stats.requests++; stats.active++; counted = true
      stats.peakActive = Math.max(stats.peakActive, stats.active)
      await delay(options.delayMs + Math.random() * options.jitterMs)
      const tool = Boolean(request.tools?.length)
      const content = tool
        ? { type: "tool_use", id: `toolu_${randomUUID()}`, name: "groucho_converse", input: reply }
        : { type: "text", text: JSON.stringify(reply) }
      const message = { id: `msg_loadtest_${randomUUID()}`, type: "message", role: "assistant", model: request.model,
        content: [content], stop_reason: tool ? "tool_use" : "end_turn", stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 } }
      if (!request.stream) {
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(message)); return
      }
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" })
      const event = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
      event("message_start", { message: { ...message, content: [], stop_reason: null } })
      event("content_block_start", { index: 0, content_block: tool ? { ...content, input: {} } : { type: "text", text: "" } })
      const text = JSON.stringify(reply)
      for (let offset = 0; offset < text.length; offset += 48) {
        event("content_block_delta", { index: 0, delta: tool
          ? { type: "input_json_delta", partial_json: text.slice(offset, offset + 48) }
          : { type: "text_delta", text: text.slice(offset, offset + 48) } })
        await delay(15)
      }
      event("content_block_stop", { index: 0 })
      event("message_delta", { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 0 } })
      event("message_stop", {})
      res.end()
    } catch {
      stats.rejected++
      if (!res.headersSent) res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Unsupported simulated model request" }))
    } finally {
      if (counted) stats.active--
    }
  })
  const url = await listen(server)
  return { url, stats, close: () => close(server) }
}
