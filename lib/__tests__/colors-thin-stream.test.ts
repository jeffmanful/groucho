import { describe, expect, it } from "vitest"
import { colorsThinEventStream, readColorsThinStream, wantsColorsThinStream } from "@/lib/colors-thin-stream"

describe("COLORS thin conversation stream", () => {
  it("delivers growing reply text, then the authoritative status and body", async () => {
    const response = colorsThinEventStream(async (onReplyDelta) => {
      onReplyDelta("Sunday swaps")
      onReplyDelta("Sunday swaps sound careful. What would you share?")
      return Response.json({ message: "Sunday swaps sound careful. What would you share?", status: "active" })
    })
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    const deltas: string[] = []
    const final = await readColorsThinStream(response, (text) => deltas.push(text))
    expect(deltas).toEqual(["Sunday swaps", "Sunday swaps sound careful. What would you share?"])
    expect(final).toEqual({ status: 200, body: { message: "Sunday swaps sound careful. What would you share?", status: "active" } })
  })

  it("passes an error status through the final event", async () => {
    const response = colorsThinEventStream(async () =>
      Response.json({ error: "Session concluded" }, { status: 409 }))
    expect(await readColorsThinStream(response, () => {})).toEqual({ status: 409, body: { error: "Session concluded" } })
  })

  it("turns a thrown turn into a retryable 503", async () => {
    const response = colorsThinEventStream(async () => { throw new Error("boom") })
    const final = await readColorsThinStream(response, () => {})
    expect(final.status).toBe(503)
    expect(final.body).toMatchObject({ retryable: true })
  })

  it("handles events split across network chunks", async () => {
    const encoder = new TextEncoder()
    const raw = 'event: delta\ndata: {"text":"Hel"}\n\nevent: delta\ndata: {"text":"Hello?"}\n\nevent: final\ndata: {"status":200,"body":{"ok":true}}\n\n'
    const chunks = [raw.slice(0, 9), raw.slice(9, 40), raw.slice(40)]
    const response = new Response(new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
        controller.close()
      },
    }))
    const deltas: string[] = []
    expect(await readColorsThinStream(response, (text) => deltas.push(text))).toEqual({ status: 200, body: { ok: true } })
    expect(deltas).toEqual(["Hel", "Hello?"])
  })

  it("opts in only when the client accepts an event stream", () => {
    expect(wantsColorsThinStream("text/event-stream")).toBe(true)
    expect(wantsColorsThinStream("application/json")).toBe(false)
    expect(wantsColorsThinStream(null)).toBe(false)
  })
})
