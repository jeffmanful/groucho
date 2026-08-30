import { describe, expect, it } from "vitest"
import {
  applyNaturalLanguageStyle,
  NATURAL_LANGUAGE_REPLY_GUIDANCE,
} from "@/lib/natural-language-style"

describe("natural language reply style", () => {
  it("explicitly tells the model not to use em dashes", () => {
    expect(NATURAL_LANGUAGE_REPLY_GUIDANCE).toContain("Do not use em dashes")
    expect(NATURAL_LANGUAGE_REPLY_GUIDANCE).toContain("sounds natural when spoken")
  })

  it("turns a spaced em dash into a short new sentence", () => {
    expect(
      applyNaturalLanguageStyle(
        "That is still abstract — give me one concrete example.",
      ),
    ).toBe("That is still abstract. Give me one concrete example.")
  })

  it("turns an inline em dash into conversational punctuation", () => {
    expect(
      applyNaturalLanguageStyle(
        "What is one song you have—or would—share with someone?",
      ),
    ).toBe("What is one song you have, or would, share with someone?")
  })
})
