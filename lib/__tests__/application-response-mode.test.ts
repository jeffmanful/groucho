import { describe, expect, it } from "vitest"
import {
  collectApplicationResponseModeHistory,
  normaliseApplicationResponseMode,
  resolveApplicationResponseMode,
} from "@/lib/application-response-mode"

describe("application response modes", () => {
  it("normalises only supported modes", () => {
    expect(normaliseApplicationResponseMode("connect")).toBe("connect")
    expect(normaliseApplicationResponseMode("acknowledge_and_ask")).toBeNull()
  })

  it("collects recent mode variety and repetition", () => {
    const history = collectApplicationResponseModeHistory([
      { role: "assistant", metadata: { response_mode: "reflect" } },
      { role: "user" },
      { role: "assistant", metadata: { response_mode: "connect" } },
      { role: "assistant", metadata: { response_mode: "connect" } },
    ])
    expect(history).toEqual({
      recentModes: ["reflect", "connect", "connect"],
      lastMode: "connect",
      repeatedModeCount: 2,
    })
  })

  it("validates mode compatibility with the accepted move", () => {
    expect(resolveApplicationResponseMode({
      proposed: "deepen", move: "rabbit_hole", isTerminal: false,
    })).toBe("deepen")
    expect(resolveApplicationResponseMode({
      proposed: "close", move: "advance", isTerminal: false,
    })).toBe("connect")
    expect(resolveApplicationResponseMode({
      proposed: "reflect", move: "decide", isTerminal: true,
    })).toBe("close")
  })
})

