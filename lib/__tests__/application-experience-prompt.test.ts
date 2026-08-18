import { describe, expect, it } from "vitest"
import { buildApplicationExperiencePromptAppendix } from "@/lib/application-experience-prompt"

describe("buildApplicationExperiencePromptAppendix", () => {
  it("always includes neutral terminal close guidance", () => {
    const appendix = buildApplicationExperiencePromptAppendix({
      opening_message: "Hi.",
      closing_message: "Thanks. We'll be in touch.",
    })
    expect(appendix).toContain("Terminal applicant-facing close")
    expect(appendix).toContain("Thanks. We'll be in touch.")
  })

  it("includes required signals, preferred input types, and max turns", () => {
    const appendix = buildApplicationExperiencePromptAppendix({
      opening_message: "Welcome.",
      closing_message: "Thanks. We'll be in touch.",
      required_signals: ["intent", "contribution"],
      preferred_input_types: ["text", "singleSelect"],
      max_turns: 4,
    })

    expect(appendix).toContain("APPLICATION CONFIGURATION")
    expect(appendix).toContain("- intent")
    expect(appendix).toContain("- contribution")
    expect(appendix).toContain("never as an ordered question sequence")
    expect(appendix).toContain("single answer can cover several goals")
    expect(appendix).toContain("grows most naturally")
    expect(appendix).toContain("Follow a rich thread before filling gaps")
    expect(appendix).toContain("do not force every applicant through the same path")
    expect(appendix).toContain("Preferred input types")
    expect(appendix).toContain("text, singleSelect")
    expect(appendix).toContain("Target maximum assistant turns before decision: 4")
  })

  it("prevents recommendation questions from asking about the recipient", () => {
    const appendix = buildApplicationExperiencePromptAppendix({
      opening_message: "What brought you here?",
      required_signals: [
        "What's the last song you recommended, and why did you think it was worth sharing?",
      ],
    })
    expect(appendix).toContain("Recommendation privacy boundary")
    expect(appendix).toContain("never ask who received")
  })

  it("binds the COLORS participation question to its approved options", () => {
    const appendix = buildApplicationExperiencePromptAppendix({
      opening_message: "What brought you here?",
      required_signals: ["Which sounds most like you?"],
    })
    expect(appendix).toContain("Participation signal")
    expect(appendix).toContain("use singleSelect")
    expect(appendix).toContain("I regularly share discoveries")
  })

  it("adds COLORS advisory rubric guidance for the forum application flow", () => {
    const appendix = buildApplicationExperiencePromptAppendix({
      opening_message: "What brought you here?",
      required_signals: [
        "What brought you here?",
        "Name an artist more people should know about. What would you want someone hearing them for the first time to notice?",
        "What's the last song you recommended, and why did you think it was worth sharing?",
        "Someone shares unfinished music that isn't really for you. How would you respond?",
        "Which sounds most like you?",
        "What's one thing you could realistically contribute in your first month?",
      ],
    })

    expect(appendix).toContain("COLORS advisory rubric")
    expect(appendix).toContain("Every completed applicant still receives human review")
    expect(appendix).toContain("real specific example of maker or multiplier participation")
    expect(appendix).toContain("Doorman behaviour matters")
    expect(appendix).toContain("What changed because of that?")
    expect(appendix).toContain("Do not score writing quality")
    expect(appendix).toContain("Strong multiplier")
    expect(appendix).toContain("one open-door move")
    expect(appendix).toContain("A rabbit-hole move rewards substance")
    expect(appendix).toContain("concise, particular observation")
    expect(appendix).toContain("Never call an answer interesting")
    expect(appendix).toContain("Artist-to-song bridge")
    expect(appendix).toContain("one of their songs that you have—or would—share")
    expect(appendix).toContain("Album bridge")
    expect(appendix).toContain("which song from that album")
    expect(appendix).toContain("Maker bridge")
    expect(appendix).toContain("Mixed artist-and-maker answer")
    expect(appendix).toContain("fresh disclosure about the applicant's own music outranks")
    expect(appendix).toContain("Invisible transitions")
    expect(appendix).toContain("let me shift")
    expect(appendix).toContain("substitutions, not extra questions")
  })
})
