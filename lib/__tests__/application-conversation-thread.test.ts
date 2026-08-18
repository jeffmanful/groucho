import { describe, expect, it } from "vitest"
import {
  collectApplicationConversationThread,
  fallbackApplicationConversationThread,
  normaliseApplicationConversationThread,
} from "@/lib/application-conversation-thread"

describe("application conversation thread", () => {
  it("normalises and bounds private thread state", () => {
    const thread = normaliseApplicationConversationThread({
      subject: `  ${"subject ".repeat(30)}  `,
      strongestDetail: "Disappearing between releases protects the work.",
      openHook: "Would greater visibility damage that restraint?",
      momentum: "high",
      applicantEnergy: "thoughtful",
      acknowledgedDetails: ["one", "two", "three", "four", "five", "five"],
      extra: "ignored",
    })
    expect(thread.subject?.length).toBeLessThanOrEqual(120)
    expect(thread.momentum).toBe("high")
    expect(thread.applicantEnergy).toBe("thoughtful")
    expect(thread.acknowledgedDetails).toEqual(["two", "three", "four", "five"])
    expect(thread).not.toHaveProperty("extra")
  })

  it("collects the most recent persisted assistant thread", () => {
    const thread = collectApplicationConversationThread([
      { role: "assistant", metadata: { conversation_thread: { subject: "Earlier", momentum: "low" } } },
      { role: "user", metadata: {} },
      { role: "assistant", metadata: { conversation_thread: {
        subject: "Artistic restraint", strongestDetail: "Space between releases",
        openHook: "Visibility versus protection", momentum: "high",
        applicantEnergy: "engaged", acknowledgedDetails: ["Space between releases"],
      } } },
    ])
    expect(thread).toMatchObject({ subject: "Artistic restraint", momentum: "high" })
  })

  it("provides a deterministic fallback for older model output", () => {
    const thread = fallbackApplicationConversationThread({
      previous: normaliseApplicationConversationThread(null),
      currentAnswer: "I run a small listening night every month.",
      assessment: {
        quality: "rich", reason: "Concrete participation.",
        evidence: { personalPointOfView: true, concreteDetail: true,
          emotionalConnection: false, independentJudgment: false, careOrContext: true },
      },
    })
    expect(thread).toMatchObject({ momentum: "high", applicantEnergy: "neutral" })
    expect(thread.strongestDetail).toContain("listening night")
  })
})

