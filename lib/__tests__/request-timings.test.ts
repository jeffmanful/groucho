import { describe, expect, it, vi } from "vitest"
import { RequestTimings } from "@/lib/request-timings"
import { log } from "@/lib/logger"

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn() },
}))

describe("RequestTimings", () => {
  it("records named stages and produces a Server-Timing header", async () => {
    const timings = new RequestTimings()
    await timings.measure("conversation_model", async () => undefined)

    expect(timings.snapshot()).toMatchObject({
      total: expect.any(Number),
      conversation_model: expect.any(Number),
    })
    expect(timings.serverTimingHeader()).toContain("conversation_model;dur=")
  })

  it("logs a completed timing snapshot only once", () => {
    const timings = new RequestTimings()
    timings.logOnce({ requestId: "req_1", sessionId: "session_1" })
    timings.logOnce({ requestId: "req_1", sessionId: "session_1" })

    expect(log.info).toHaveBeenCalledTimes(1)
  })
})
