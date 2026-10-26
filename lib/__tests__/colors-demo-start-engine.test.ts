import { afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"
const { start } = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock("@/lib/start-gatekeeper-session", () => ({ startGatekeeperSession: start }))
vi.mock("@/lib/colors-thin-conversation", () => ({ COLORS_THIN_PILOT_MARKER: "colors_thin_pilot_v1" }))
vi.mock("@/lib/colors-demo-access", () => ({ colorsDemoProject: async () => ({ context: { settings: {} } }) }))
vi.mock("@/lib/colors-demo-token", () => ({ DEMO_SESSION_COOKIE: "demo", demoTester: async () => ({ email: "tester@example.test" }), issueDemoToken: async () => "synthetic-token" }))
import { POST } from "@/app/api/demo/colors/start/route"
const flag = process.env.GROUCHO_COLORS_THIN_PILOT
afterEach(() => {
  if (flag === undefined) delete process.env.GROUCHO_COLORS_THIN_PILOT
  else process.env.GROUCHO_COLORS_THIN_PILOT = flag
})
describe("COLORS application engine selection", () => {
  it.each(["1", "0"])("starts artists on the newer engine with pilot flag %s", async value => {
    process.env.GROUCHO_COLORS_THIN_PILOT = value
    start.mockResolvedValue(NextResponse.json({ status: "active" }))
    const artist = { city: "Example City", age: 27, socialLinks: [], musicLinks: [] }
    const response = await POST(new NextRequest("https://example.test/api/demo/colors/start", {method:"POST",body:JSON.stringify({sessionId:"00000000-0000-4000-8000-000000000001",applicant:{email:"person@example.test",name:"Example Person",artist}})}))
    expect(response.status).toBe(200)
    expect(start).toHaveBeenLastCalledWith(expect.objectContaining({conversationEngine:"colors_thin_pilot_v1",applicantIdentity:expect.objectContaining({artist})}))
  })
  it("uses the same engine for community applicants when enabled", async () => {
    process.env.GROUCHO_COLORS_THIN_PILOT = "1"
    start.mockResolvedValue(NextResponse.json({ status: "active" }))
    await POST(new NextRequest("https://example.test/api/demo/colors/start", {method:"POST",body:JSON.stringify({sessionId:"00000000-0000-4000-8000-000000000002",applicant:{email:"person@example.test",name:"Example Person",details:{city:"Example City",age:27,socialLinks:[],musicLinks:[]}}})}))
    expect(start).toHaveBeenLastCalledWith(expect.objectContaining({conversationEngine:"colors_thin_pilot_v1"}))
  })
})
