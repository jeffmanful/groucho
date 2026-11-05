import { createServer } from "node:http"
import { NextRequest } from "next/server"
import { listen, close } from "./simulated-ai"

/** Uses the actual API route handlers. Does not emulate Next hosting, Proxy, CDN or the browser. */
export async function startApplicationServer() {
  const start = await import("../../app/v1/sessions/[sessionId]/start/route")
  const messages = await import("../../app/v1/sessions/[sessionId]/messages/route")
  const server = createServer(async (req, res) => {
    const match = /^\/v1\/sessions\/([A-Za-z0-9_-]{8,128})\/(start|messages)$/.exec(req.url ?? "")
    if (req.method !== "POST" || !match) { res.writeHead(404).end(); return }
    try {
      let body = ""
      for await (const chunk of req) {
        body += chunk
        if (body.length > 32_000) { res.writeHead(413).end(); return }
      }
      const headers = new Headers()
      for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value)
      const request = new NextRequest(`http://127.0.0.1${req.url}`, { method: "POST", headers, body })
      const handler = match[2] === "start" ? start.POST : messages.POST
      const response = await handler(request, { params: Promise.resolve({ sessionId: match[1] }) })
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch {
      res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Load-test handler failed" }))
    }
  })
  return { url: await listen(server), close: () => close(server) }
}
