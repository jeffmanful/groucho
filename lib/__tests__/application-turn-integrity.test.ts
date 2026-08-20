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

  it.each([
    "Before we dig into that—what is a COLORS performance that stayed with you?",
    "Before we get into this, what is a COLORS performance that stayed with you?",
    "Before we go any further: what is a COLORS performance that stayed with you?",
    "Before we go deeper, what is a COLORS performance that stayed with you?",
    "Before we continue, what is a COLORS performance that stayed with you?",
    "Let me ask differently—what is a COLORS performance that stayed with you?",
    "Let me ask you differently—what is a COLORS performance that stayed with you?",
    "Let me ask this differently—what is a COLORS performance that stayed with you?",
    "Let me ask something different. what is a COLORS performance that stayed with you?",
    "Let me ask something a bit more specific: what is a COLORS performance that stayed with you?",
    "Let me ask a different way. what is a COLORS performance that stayed with you?",
    "Let me ask this another way—what is a COLORS performance that stayed with you?",
    "Let me try it differently—what is a COLORS performance that stayed with you?",
    "Let me try something simpler—what is a COLORS performance that stayed with you?",
    "Before you explore, what is a COLORS performance that stayed with you?",
  ])("removes wider interview-stage narration from %s", (reply) => {
    expect(stripApplicationProcessLanguage(reply)).toEqual({
      reply: "What is a COLORS performance that stayed with you?",
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

  it("accepts reciprocal giving and concrete participation as contribution", () => {
    expect(
      applicationAnswerSupportsSignal(
        contribution,
        "I can give other artists specific production feedback in return.",
      ),
    ).toBe(true)
    expect(
      applicationAnswerSupportsSignal(
        contribution,
        "I can take part through creating, documenting, recommending, organising, and welcoming.",
      ),
    ).toBe(true)
  })

  it("does not cover an artist reference with rich but off-target evidence", () => {
    const artistReference = applicationSignalDefinitions([
      "Name an artist more people should know about.",
    ])[0]

    expect(
      applicationAnswerSupportsSignal(
        artistReference,
        "The useful exchange is specific: what the arrangement is doing, whether the vocal lands, and what the artist wants the track to become.",
      ),
    ).toBe(false)
    expect(
      applicationAnswerSupportsSignal(
        artistReference,
        "dexter in the newsagent. Their delivery leaves room for the lyric to feel lived-in.",
      ),
    ).toBe(true)
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

  it("replaces a structured question that does not match its options", () => {
    expect(
      ensureExplicitStructuredInputPrompt({
        reply: "What are you trying to express in your own music?",
        interaction: {
          intent: "probe",
          inputType: "singleSelect",
          options: [
            "I mostly listen",
            "I like discussing music",
            "I enjoy giving feedback",
            "I regularly share discoveries",
          ],
          emotionalState: "curious",
          visualState: "curious",
        },
        nextSignal: {
          label: "Which sounds most like you?",
          promptRoutes: ["How do you usually participate around music?"],
        },
      }),
    ).toEqual({
      reply: "Which of these sounds most like how you participate around music?",
      added: true,
    })
  })

  it("detects an exact repeated question even when the new reply adds a receipt", () => {
    expect(
      activeApplicationReplyIssue({
        reply:
          "That tension stays unresolved. What's one of their songs that you have—or would—share with someone, and why?",
        previousQuestion:
          "What is one of their songs that you have—or would—share with someone, and why?",
        interaction: {
          intent: "probe",
          inputType: "text",
          emotionalState: "interested",
          visualState: "interested",
        },
        closingMessage: "It was good getting to understand you better.",
      }),
    ).toBe("repeated_question")
  })

  it("rejects an artist-to-song pronoun bridge before an artist is named", () => {
    expect(
      activeApplicationReplyIssue({
        reply:
          "What is one of their songs that you have—or would—share with someone, and why?",
        interaction: {
          intent: "probe",
          inputType: "text",
          emotionalState: "curious",
          visualState: "thinking",
        },
        closingMessage: "It was good getting to understand you better.",
        hasArtistAntecedent: false,
      }),
    ).toBe("missing_artist_antecedent")
  })

  it("detects a repeated question even when another question intervened", () => {
    expect(
      activeApplicationReplyIssue({
        reply:
          "Which part of what you already do around music could you keep contributing here?",
        previousQuestion: [
          "Which part of what you already do around music could you keep contributing here?",
          "What do you actually do around music now?",
        ].join("\n"),
        interaction: {
          intent: "probe",
          inputType: "text",
          emotionalState: "interested",
          visualState: "interested",
        },
        closingMessage: "It was good getting to understand you better.",
      }),
    ).toBe("repeated_question")
  })
})
