import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ReportEvidenceOverview } from "@/components/admin/ReportEvidenceOverview"
import { normaliseReviewerReport } from "@/lib/reviewer-report"

describe("reviewer evidence visibility", () => {
  it("shows neutral unknowns even when the report has no material gaps or reviewer questions", () => {
    const report = normaliseReviewerReport({
      applicant_bio: "Makes music and hopes for feedback.", advisory_recommendation: "recommend", confidence_score: 0.5,
      reviewer_focus: "Consider the limited account.", weak_or_missing_signals: [], safety_or_integrity_flags: [],
      evidence_limits: [{ signal_key: "tones_connection", material_gap: true, explanation: "Invented requirement" }],
      evidence_state: [
        { signal_key: "joining_motivation", coverage: "supported", source_message_ids: ["a1"], material_gap: false, gap_reason: "" },
        { signal_key: "tones_connection", coverage: "unverified", source_message_ids: [], material_gap: false, gap_reason: "" },
      ],
    })
    const html = renderToStaticMarkup(createElement(ReportEvidenceOverview, { state: report?.evidence_state }))
    expect(html).toContain("Supported by their account")
    expect(html).toContain("Not established or unresolved")
    expect(html).toContain("TONES connection")
    expect(html).toContain("Unknowns are neutral")
    expect(html).not.toContain("needs clarification")
    expect(report?.weak_or_missing_signals).toEqual([])
    expect(report?.evidence_limits).toEqual([expect.objectContaining({ signal_key: "tones_connection", material_gap: false })])
  })

  it("shows the actual reason for a material gap separately from neutral unknowns", () => {
    const html = renderToStaticMarkup(createElement(ReportEvidenceOverview, { state: [
      { signal_key: "forum_participation", coverage: "partial", source_message_ids: ["a2"], material_gap: true, gap_reason: "The applicant gave conflicting plans requiring clarification." },
    ] }))
    expect(html).toContain("needs clarification")
    expect(html).toContain("conflicting plans")
    expect(html).toContain("not independently verified facts")
  })
})
