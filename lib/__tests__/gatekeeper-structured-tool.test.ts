import { describe, expect, it } from "vitest"
import {
  GATEKEEPER_RESPONSE_TOOL_NAME,
  parseGatekeeperStructuredResponse,
} from "@/lib/gatekeeper-structured-tool"

function toolBlock(input: Record<string, unknown>) {
  return {
    type: "tool_use" as const,
    id: "toolu_test",
    name: GATEKEEPER_RESPONSE_TOOL_NAME,
    input,
  }
}

describe("parseGatekeeperStructuredResponse", () => {
  it("reads reply, terminal, and interaction spec from groucho_respond", () => {
    const content = [
      toolBlock({
        reply: "Tell me more.",
        terminal: "none",
        intent: "probe",
        inputType: "text",
        emotionalState: "curious",
        visualState: "curious",
        scores: {
          specificity: 0.7,
          authenticity: 0.8,
          cultural_depth: 0.6,
          overall: 0.7,
        },
        nextSignalKey: "community_contribution",
      }),
    ]
    const out = parseGatekeeperStructuredResponse(content as never)
    expect(out.toolSeen).toBe(true)
    expect(out.terminal).toBe("none")
    expect(out.reply).toBe("Tell me more.")
    expect(out.interaction).toEqual({
      intent: "probe",
      inputType: "text",
      emotionalState: "curious",
      visualState: "curious",
    })
    expect(out.scores).toEqual({
      specificity: 0.7,
      authenticity: 0.8,
      cultural_depth: 0.6,
      overall: 0.7,
    })
    expect(out.nextSignalKey).toBe("community_contribution")
  })

  it("defaults terminal to none when tool input is invalid", () => {
    const content = [
      toolBlock({
        reply: "Hi",
        terminal: "maybe",
        intent: "probe",
        inputType: "text",
        emotionalState: "neutral",
        visualState: "thinking",
      }),
    ]
    const out = parseGatekeeperStructuredResponse(content as never)
    expect(out.toolSeen).toBe(true)
    expect(out.terminal).toBe("none")
  })

  it("falls back to defaults when tool is absent", () => {
    const content = [
      { type: "text" as const, text: "Plain\n" },
      { type: "text" as const, text: "reply" },
    ]
    const out = parseGatekeeperStructuredResponse(content as never)
    expect(out.toolSeen).toBe(false)
    expect(out.terminal).toBe(null)
    expect(out.reply).toBe("Plain\n\nreply")
    expect(out.interaction.inputType).toBe("text")
    expect(out.scores).toEqual({
      specificity: 0.5,
      authenticity: 0.5,
      cultural_depth: 0.5,
      overall: 0.5,
    })
    expect(out.nextSignalKey).toBeNull()
  })

  it("uses neutral scores when the structured assessment is malformed", () => {
    const content = [
      toolBlock({
        reply: "Tell me more.",
        terminal: "none",
        intent: "probe",
        inputType: "text",
        emotionalState: "curious",
        visualState: "curious",
        scores: { specificity: "high" },
      }),
    ]
    const out = parseGatekeeperStructuredResponse(content as never)
    expect(out.scores.overall).toBe(0.5)
  })
})
