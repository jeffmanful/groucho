/**
 * Server-sent events for the newer COLORS conversation engine.
 *
 * The stream carries two event types:
 * - `delta`: `{ text }`, the applicant-facing reply so far (each value extends the previous one);
 * - `final`: `{ status, body }`, the exact HTTP status and JSON body the non-streaming route returns.
 *
 * `final` is always authoritative. A client shows `delta` text while waiting and then handles
 * `final` exactly as it would handle an ordinary JSON response.
 *
 * This module has no server-only imports so the browser can use the reader below.
 */

export const COLORS_THIN_STREAM_CONTENT_TYPE = "text/event-stream"

export type ColorsThinStreamFinal = { status: number; body: unknown }

function event(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
}

/** Wrap a conversation turn that reports reply text through `onReplyDelta` as an SSE response. */
export function colorsThinEventStream(
  run: (onReplyDelta: (text: string) => void) => Promise<Response>,
): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (name: string, data: unknown) => controller.enqueue(encoder.encode(event(name, data)))
      try {
        const response = await run((text) => send("delta", { text }))
        send("final", { status: response.status, body: await response.json().catch(() => ({})) })
      } catch {
        send("final", { status: 503, body: { error: "Groucho could not respond. Please try again.", retryable: true } })
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, {
    headers: {
      "Content-Type": `${COLORS_THIN_STREAM_CONTENT_TYPE}; charset=utf-8`,
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

/** True when a client asked for the streaming variant of the message route. */
export function wantsColorsThinStream(accept: string | null): boolean {
  return Boolean(accept?.includes(COLORS_THIN_STREAM_CONTENT_TYPE))
}

/**
 * Read a streamed turn in the browser. Calls `onDelta` for each reply update and resolves with the
 * authoritative final status and body. A stream that ends without `final` resolves as a 503.
 */
export async function readColorsThinStream(
  response: Response,
  onDelta: (text: string) => void,
): Promise<ColorsThinStreamFinal> {
  const reader = response.body?.getReader()
  if (!reader) return { status: 503, body: { error: "Groucho could not respond. Please try again." } }
  const decoder = new TextDecoder()
  let buffer = ""
  let final: ColorsThinStreamFinal | null = null
  const handle = (block: string) => {
    let name = "message"
    const data: string[] = []
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim()
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart())
    }
    if (!data.length) return
    let parsed: unknown
    try {
      parsed = JSON.parse(data.join("\n"))
    } catch {
      return
    }
    const value = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}
    if (name === "delta" && typeof value.text === "string") onDelta(value.text)
    if (name === "final" && typeof value.status === "number") final = { status: value.status, body: value.body }
  }
  for (;;) {
    const { value, done } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: true })
    let boundary = buffer.indexOf("\n\n")
    while (boundary >= 0) {
      handle(buffer.slice(0, boundary))
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf("\n\n")
    }
    if (done) break
  }
  if (buffer.trim()) handle(buffer)
  return final ?? { status: 503, body: { error: "Groucho could not respond. Please try again.", retryable: true } }
}
