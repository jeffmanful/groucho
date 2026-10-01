import { describe, expect, it } from "vitest"
import fixtures from "@/evals/colors-demo-transcripts.json"
import { ensureEvidenceBackedReviewerReport } from "@/lib/reviewer-report"

describe("recorded COLORS demo conversations", () => {
  for (const persona of fixtures.personas) {
    it(`keeps exact, question-linked applicant evidence for ${persona.name}`, () => {
      const messages = persona.messages.map((message, index) => ({
        id: `${persona.name}-${index}`,
        role: message.role as "assistant" | "user",
        content: message.content,
      }))
      const report = ensureEvidenceBackedReviewerReport({
        report: null,
        terminalStatus: "redirected",
        scores: { overall: 0.5 },
        definitions: [],
        answers: [],
        messages,
      })
      const applicantMessages = messages.filter((message) => message.role === "user")
      expect(report.evidence_references).toHaveLength(applicantMessages.length)
      for (const reference of report.evidence_references) {
        const index = messages.findIndex((message) => message.id === reference.source_message_id)
        expect(index).toBeGreaterThan(0)
        expect(reference.excerpt).toBe(messages[index].content)
        expect(reference.preceding_question).toBe(messages[index - 1].content)
      }
      expect(report.applicant_bio).not.toMatch(/\b(he|she|his|her)\b/i)
    })
  }
})
