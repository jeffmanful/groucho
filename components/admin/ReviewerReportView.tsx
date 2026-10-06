import type { ReviewerReport } from "@/lib/reviewer-report"

function readable(value: string): string {
  return value.replaceAll("_", " ")
}

function EvidenceQuotes({
  ids,
  report,
}: {
  ids: string[]
  report: ReviewerReport
}) {
  const references = ids.flatMap((id) => {
    const reference = report.evidence_references.find((item) => item.source_message_id === id)
    return reference ? [reference] : []
  })
  if (!references.length) return null
  return (
    <div className="mt-2 space-y-2">
      {references.map((reference) => (
        <blockquote
          key={reference.source_message_id}
          className="border-l border-white/20 pl-3 text-xs leading-relaxed text-white/55"
        >
          <span className="mb-1 block text-[0.63rem] uppercase tracking-wider text-white/35">
            {reference.signal_label}
          </span>
          “{reference.excerpt}”
        </blockquote>
      ))}
    </div>
  )
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-white/10 pt-4">
      <h4 className="mb-2 text-[0.65rem] uppercase tracking-[0.12em] text-white/40">
        {title}
      </h4>
      {children}
    </section>
  )
}

export function ReviewerReportView({
  report,
  sessionStatus,
  loading = false,
}: {
  report: ReviewerReport | null
  sessionStatus: string
  loading?: boolean
}) {
  const detailed = report?.detailed_opinion
  const recommendation = report?.advisory_recommendation === "human_review"
    ? "needs discussion"
    : report?.advisory_recommendation ?? ""
  const concluded = ["passed", "redirected", "rejected", "failed", "abandoned"].includes(sessionStatus)

  return (
    <section aria-label="Generated report" className="border border-white/10 bg-white/[0.025] p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-[0.7rem] font-normal uppercase tracking-[0.13em] text-white/55">
          Generated report
        </h3>
        {report ? (
          <span className="border border-white/15 px-2 py-1 text-[0.65rem] uppercase tracking-wider text-white/65">
            {detailed ? "Detailed report" : "Summary report"}
          </span>
        ) : null}
      </div>

      {loading ? (
        <p className="m-0 text-sm text-white/45">Loading report…</p>
      ) : !report ? (
        <p className="m-0 text-sm leading-relaxed text-white/45">
          {concluded
            ? "No generated report is available for this session. Read the conversation below."
            : "A report will appear here after the conversation concludes."}
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.68rem] uppercase tracking-wider text-white/50">
            <span className="text-white/85">{recommendation}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              {detailed ? "Evidence sufficiency" : "Report score"} {Math.round(report.confidence_score * 100)}/100
            </span>
          </div>
          <p className="m-0 text-sm leading-relaxed text-white/85">
            {detailed?.snapshot?.applicant_summary ?? report.applicant_bio}
          </p>
          {detailed?.snapshot?.tags.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Applicant evidence tags">
              {detailed.snapshot.tags.map((tag) => (
                <span key={tag.value} className="border border-white/15 px-2 py-1 text-[0.65rem] text-white/65">
                  {readable(tag.value)}
                </span>
              ))}
            </div>
          ) : null}
          <p className="mt-3 text-xs leading-relaxed text-white/55">
            {detailed?.advisory_reason ?? report.reviewer_focus}
          </p>

          <details className="group mt-5 border-t border-white/10 pt-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-xs text-white/75 marker:hidden hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70">
              <span>Full assessment and evidence</span>
              <span aria-hidden="true" className="text-lg leading-none group-open:rotate-45">+</span>
            </summary>
            <div className="mt-4 space-y-5 text-sm leading-relaxed text-white/70">
              {detailed ? (
                <>
                  <ReportSection title="Overall assessment">
                    <p className="m-0">{detailed.overall_assessment}</p>
                    {detailed.decisive_reasons.length ? (
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {detailed.decisive_reasons.map((reason, index) => <li key={index}>{reason}</li>)}
                      </ul>
                    ) : null}
                  </ReportSection>
                  <ReportSection title="Evidence and interpretation">
                    <div className="space-y-4">
                      {detailed.claim_assessments.map((claim, index) => (
                        <div key={`${claim.claim}-${index}`}>
                          <span className="text-[0.65rem] uppercase tracking-wider text-white/40">
                            {claim.assessment}
                          </span>
                          <p className="mb-1 mt-1 text-white/85">{claim.claim}</p>
                          <p className="m-0 text-xs text-white/55">{claim.interpretation}</p>
                          <EvidenceQuotes ids={claim.evidence_reference_ids} report={report} />
                        </div>
                      ))}
                    </div>
                  </ReportSection>
                  {detailed.curatorial_approach?.present ? (
                    <ReportSection title="Curatorial approach">
                      <p className="m-0">{detailed.curatorial_approach.summary}</p>
                      <EvidenceQuotes ids={detailed.curatorial_approach.evidence_reference_ids} report={report} />
                    </ReportSection>
                  ) : null}
                  <ReportSection title="Likely contribution">
                    <p className="m-0">{detailed.likely_contribution}</p>
                  </ReportSection>
                  {detailed.reservations.length ? (
                    <ReportSection title="Reservations">
                      <div className="space-y-4">
                        {detailed.reservations.map((reservation, index) => (
                          <div key={`${reservation.text}-${index}`}>
                            <p className="m-0">{reservation.text}</p>
                            <EvidenceQuotes ids={reservation.evidence_reference_ids} report={report} />
                          </div>
                        ))}
                      </div>
                    </ReportSection>
                  ) : null}
                  {detailed.reviewer_questions.length ? (
                    <ReportSection title="Questions for a human reviewer">
                      <ul className="m-0 list-disc space-y-1 pl-5">
                        {detailed.reviewer_questions.map((question, index) => <li key={index}>{question}</li>)}
                      </ul>
                    </ReportSection>
                  ) : null}
                </>
              ) : (
                <ReportSection title="Evidence summary">
                  <ul className="m-0 list-disc space-y-1 pl-5">
                    {report.evidence_summary.map((item, index) => <li key={index}>{item}</li>)}
                  </ul>
                </ReportSection>
              )}
              {report.weak_or_missing_signals.length ? (
                <ReportSection title="Weak or missing signals">
                  <ul className="m-0 list-disc space-y-1 pl-5">
                    {report.weak_or_missing_signals.map((item, index) => <li key={index}>{item}</li>)}
                  </ul>
                </ReportSection>
              ) : null}
              {report.safety_or_integrity_flags.length ? (
                <ReportSection title="Verified integrity flags">
                  <ul className="m-0 list-disc space-y-1 pl-5">
                    {report.safety_or_integrity_flags.map((item, index) => <li key={index}>{item}</li>)}
                  </ul>
                </ReportSection>
              ) : null}
              <ReportSection title="Source excerpts">
                <div className="space-y-3">
                  {report.evidence_references.map((reference) => (
                    <div key={`${reference.source_message_id}-${reference.signal_key}`}>
                      <p className="mb-1 text-xs text-white/55">{reference.signal_label}</p>
                      <p className="m-0 text-xs text-white/75">“{reference.excerpt}”</p>
                    </div>
                  ))}
                </div>
              </ReportSection>
            </div>
          </details>
        </>
      )}
    </section>
  )
}
