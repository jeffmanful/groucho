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
    expect(appendix).toContain("Do not use em dashes")
    expect(appendix).toContain("sounds natural when spoken")
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
    expect(appendix).toContain("never a required line or ordered sequence")
    expect(appendix).toContain("single answer can cover several goals")
    expect(appendix).toContain("Infer the actual question")
    expect(appendix).toContain("Follow a rich thread before filling gaps")
    expect(appendix).toContain("Do not force every applicant through the same path")
    expect(appendix).toContain("Preferred input types")
    expect(appendix).toContain("text, singleSelect")
    expect(appendix).toContain("Soft conversational target: around 4 applicant answers")
    expect(appendix).toContain("not a deadline")
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
    expect(appendix).toContain("examples that may help")
    expect(appendix).toContain("sharing discoveries")
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
    expect(appendix).toContain("shared trunk with adaptive branches")
    expect(appendix).toContain("private, revisable description")
    expect(appendix).toContain("not a routing mechanism")
    expect(appendix).toContain("first conversational inflection point")
    expect(appendix).toContain("overlapping, fluid facets")
    expect(appendix).toContain("may collaborate or curate")
    expect(appendix).toContain("may make or upload their own music")
    expect(appendix).toContain("never turn `I want to start`")
    expect(appendix).toContain("Establish their relationship to COLORS early")
    expect(appendix).toContain("do not force it into the second question")
    expect(appendix).toContain("not a fandom, recall, or cultural-status test")
    expect(appendix).toContain("Treat sustained reciprocity as an enhancement")
    expect(appendix).toContain("Quiet but repeatable listening")
    expect(appendix).toContain("Treat situated cultural perspective")
    expect(appendix).toContain("what they notice that outsiders might miss")
    expect(appendix).toContain("Do not require an exact location")
    expect(appendix).toContain("Do not require anyone")
    expect(appendix).toContain("Strong enthusiast")
    expect(appendix).toContain("Strong artist")
    expect(appendix).toContain("Strong early-stage artist")
    expect(appendix).toContain("Strong listener")
    expect(appendix).toContain("Strong curator")
    expect(appendix).toContain("Strong hybrid")
    expect(appendix).toContain("lack of professional credits")
    expect(appendix).toContain("lack of releases or release links")
    expect(appendix).toContain("Doorman behaviour matters")
    expect(appendix).toContain("What changed because of that?")
    expect(appendix).toContain("Do not score writing quality")
    expect(appendix).toContain("Strong multiplier")
    expect(appendix).toContain("an open-door move")
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
    expect(appendix).toContain("Grounded contribution bridge")
    expect(appendix).toContain("What would you actually do with that in the Forum?")
    expect(appendix).toContain("that kind of listening")
    expect(appendix).toContain("Natural transitions")
    expect(appendix).toContain("receive → connect → invite")
    expect(appendix).toContain("one or two short sentences")
    expect(appendix).toContain("let me shift")
    expect(appendix).toContain("substitutions, not extra questions")
  })
})
