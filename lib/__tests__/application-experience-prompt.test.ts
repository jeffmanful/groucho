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
    expect(appendix).toContain("ordered signal sequence")
    expect(appendix).toContain("nextRequiredSignalKey")
    expect(appendix).toContain("ask it verbatim")
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
})
