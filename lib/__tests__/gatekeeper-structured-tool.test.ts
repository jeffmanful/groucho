import { describe, expect, it } from "vitest"
import {
  GATEKEEPER_RESPONSE_TOOL_NAME,
  parseGatekeeperStructuredResponse,
} from "@/lib/gatekeeper-structured-tool"

function toolBlock(input: { reply: string; terminal: string }) {
  return {
    type: "tool_use" as const,
    id: "toolu_test",
    name: GATEKEEPER_RESPONSE_TOOL_NAME,
    input,
  }
}

describe("parseGatekeeperStructuredResponse", () => {
  it("reads reply and terminal from groucho_respond", () => {
    const content = [toolBlock({ reply: "Next time.", terminal: "redirect" })]
    const out = parseGatekeeperStructuredResponse(content as never)
    expect(out.toolSeen).toBe(true)
    expect(out.terminal).toBe("redirect")
    expect(out.reply).toBe("Next time.")
  })

  it("defaults terminal to none when tool input is invalid", () => {
    const content = [toolBlock({ reply: "Hi", terminal: "maybe" })]
    const out = parseGatekeeperStructuredResponse(content as never)
    expect(out.toolSeen).toBe(true)
    expect(out.terminal).toBe("none")
  })

  it("falls back to joined text when tool is absent", () => {
    const content = [
      { type: "text" as const, text: "Plain\n" },
      { type: "text" as const, text: "reply" },
    ]
    const out = parseGatekeeperStructuredResponse(content as never)
    expect(out.toolSeen).toBe(false)
    expect(out.terminal).toBe(null)
    expect(out.reply).toBe("Plain\n\nreply")
  })
})
