import { describe, expect, it } from "vitest"
import {
  activeApplicationReplyIssue,
  applicationAnswerSupportsSignal,
  applicationQuestionSupportsSignal,
  ensureExplicitStructuredInputPrompt,
  repairApplicationReplyWithQuestion,
  stripApplicationProcessLanguage,
} from "@/lib/application-turn-integrity"
import { applicationSignalDefinitions } from "@/lib/application-signal-state"

const contribution = applicationSignalDefinitions([
  "What's one thing you could realistically contribute in your first month?",
])[0]

describe("application turn integrity", () => {
  it("does not accept an artist question as a participation question", () => {
    const participation = applicationSignalDefinitions([
      "Which sounds most like you?",
    ])[0]
    expect(
      applicationQuestionSupportsSignal(
        participation,
        "Tell me about an artist more people should know about.",
      ),
    ).toBe(false)
    expect(
      applicationQuestionSupportsSignal(
        participation,
        "Where does music become social for you now, even informally?",
      ),
    ).toBe(true)
    expect(
      applicationQuestionSupportsSignal(
        participation,
        "What are you noticing in the music scene around you that someone outside it might miss?",
      ),
    ).toBe(true)
    expect(
      applicationQuestionSupportsSignal(
        participation,
        "Do you feel inside the music scene around you, adjacent to it, or mostly looking in from outside?",
      ),
    ).toBe(true)
  })

  it("removes interview-stage narration without losing the grounded receipt", () => {
    expect(
      stripApplicationProcessLanguage(
        "Got it—that track settles you. Before we wrap, I want to understand what you'd actually bring here.",
      ),
    ).toEqual({
      reply:
        "Got it—that track settles you. I want to understand what you'd actually bring here.",
      removed: true,
    })
  })

  it("preserves a grounded receipt when replacing a mismatched question", () => {
    expect(
      repairApplicationReplyWithQuestion({
        reply:
          "You keep returning to the listening nights you host. Who is an artist more people should know?",
        currentAnswer:
          "I host small listening nights where everyone brings one unfinished track.",
        question: "What do you actually do around music now?",
      }),
    ).toEqual({
      reply:
        "You keep returning to the listening nights you host. What do you actually do around music now?",
      receiptPreserved: true,
    })
  })

  it("does not treat a community condition as the concrete contribution question", () => {
    expect(
      applicationQuestionSupportsSignal(
        contribution,
        "What would a music community need to feel like for you to take part rather than only observe?",
      ),
    ).toBe(false)
    expect(
      applicationQuestionSupportsSignal(
        contribution,
        "What would you actually share, notice, or do here during your first month?",
      ),
    ).toBe(true)
    expect(
      applicationQuestionSupportsSignal(
        contribution,
        "When a music space keeps you coming back, what do you naturally give to it?",
      ),
    ).toBe(true)
    expect(
      applicationQuestionSupportsSignal(
        contribution,
        "Which part of what you already do around music could you keep contributing here?",
      ),
    ).toBe(true)
  })

  it("does not count a conditional community preference as concrete contribution evidence", () => {
    expect(
      applicationAnswerSupportsSignal(
        contribution,
        "I'd take part if a comment could be as simple as connecting a song to a feeling.",
      ),
    ).toBe(false)
    expect(
      applicationAnswerSupportsSignal(
        contribution,
        "I'd share one discovery each week and explain what I noticed in it.",
      ),
    ).toBe(true)
    expect(
      applicationAnswerSupportsSignal(
        contribution,
        "I run a listening group and would host one focused thread here.",
      ),
    ).toBe(true)
    expect(
      applicationAnswerSupportsSignal(
        contribution,
        "I regularly host a small listening circle and share notes after each session.",
      ),
    ).toBe(true)
    expect(
      applicationAnswerSupportsSignal(
        contribution,
        "I like spaces where other people keep the discussion active.",
      ),
    ).toBe(false)
  })

  it("adds a visible question when structured options arrive with only an acknowledgement", () => {
    const participation = applicationSignalDefinitions([
      "Which sounds most like you?",
    ])[0]
    const result = ensureExplicitStructuredInputPrompt({
      reply:
        "You're thinking about what might resonate with them, not just what you like.",
      interaction: {
        intent: "probe",
        inputType: "singleSelect",
        options: ["I mostly listen", "I regularly share discoveries"],
        emotionalState: "interested",
        visualState: "interested",
      },
      nextSignal: participation,
    })

    expect(result.added).toBe(true)
    expect(result.reply).toContain(
      "Which of these sounds most like how you participate around music?",
    )
  })

  it("does not duplicate an existing structured-input question", () => {
    const result = ensureExplicitStructuredInputPrompt({
      reply: "Which sounds most like you?",
      interaction: {
        intent: "probe",
        inputType: "singleSelect",
        options: ["Listener", "Curator"],
        emotionalState: "curious",
        visualState: "curious",
      },
      nextSignal: null,
    })

    expect(result).toEqual({
      reply: "Which sounds most like you?",
      added: false,
    })
  })

  it("detects terminal application copy on an active text turn", () => {
    expect(
      activeApplicationReplyIssue({
        reply: "Thank you. We'll get in touch about your application soon.",
        interaction: {
          intent: "acknowledge",
          inputType: "text",
          emotionalState: "decisive",
          visualState: "decision",
        },
        closingMessage:
          "Thank you. We'll get in touch about your application soon.",
      }),
    ).toBe("terminal_language")
  })

  it("detects an active reflection that leaves no invitation", () => {
    expect(
      activeApplicationReplyIssue({
        reply:
          "You're thinking about what would land with them, not only what you like.",
        interaction: {
          intent: "acknowledge",
          inputType: "text",
          emotionalState: "interested",
          visualState: "interested",
        },
        closingMessage:
          "Thank you. We'll get in touch about your application soon.",
      }),
    ).toBe("missing_invitation")
  })

  it("accepts a clear text invitation with or without a question mark", () => {
    const interaction = {
      intent: "probe" as const,
      inputType: "text" as const,
      emotionalState: "curious" as const,
      visualState: "curious" as const,
    }
    expect(
      activeApplicationReplyIssue({
        reply: "What did you notice after sitting with it longer?",
        interaction,
        closingMessage: "Thanks for applying.",
      }),
    ).toBeNull()
    expect(
      activeApplicationReplyIssue({
        reply: "Tell me about the detail that changed across repeat listens.",
        interaction,
        closingMessage: "Thanks for applying.",
      }),
    ).toBeNull()
  })
})
