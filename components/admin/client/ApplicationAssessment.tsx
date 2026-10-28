import { reviewerEvidenceLimits, type ReviewerReport } from "@/lib/reviewer-report"
import styles from "./client.module.css"

/** The same verified report used by Groucho, shown in the client workspace's own theme. */
export function ApplicationAssessment({ report }: { report: ReviewerReport }) {
  const detailed = report.detailed_opinion
  const limits = reviewerEvidenceLimits(report.evidence_state ?? [])
  const supported = (report.evidence_state ?? []).filter(entry => entry.coverage === "supported")
  const label = (key: string) => key.replaceAll("_", " ").replace(/^colors/, "COLORS").replace(/^tones/, "TONES")
  const quotes = (ids: string[]) => report.evidence_references.filter(reference => ids.includes(reference.source_message_id))
  return (
    <section style={{ display: "grid", gap: 12 }} aria-label="Assessment and evidence limits">
      {report.evidence_state?.length ? (
        <div className={styles.panel} style={{ padding: 20, display: "grid", gap: 12 }}>
          <h2 className={styles.groupTitle}>What is established</h2>
          <p className={styles.secondary}>{supported.length ? supported.map(entry => label(entry.signal_key)).join(", ") : "No area is established yet."}</p>
          <h3 className={styles.groupTitle}>Not established or unresolved</h3>
          {limits.length ? <ul className={styles.secondary}>{limits.map(entry => (
            <li key={entry.signal_key}>{entry.label}{entry.material_gap ? ` — ${entry.explanation}` : " (neutral unknown)"}</li>
          ))}</ul> : <p className={styles.secondary}>No remaining unknowns recorded for the reviewed areas.</p>}
          <p className={`${styles.muted} ${styles.small}`}>These are applicant accounts, not independently verified facts. Unknowns are neutral.</p>
        </div>
      ) : null}
      <details className={styles.details}>
        <summary>Full assessment and evidence</summary>
        <div className={styles.panel} style={{ marginTop: 12, padding: 20, display: "grid", gap: 20 }}>
          <p className={`${styles.muted} ${styles.small}`}>Evidence sufficiency: {Math.round(report.confidence_score * 100)}/100. This is not a probability of fit or an admission decision.</p>
          <div style={{ display: "grid", gap: 8 }}>
            <h3 className={styles.groupTitle}>Overall assessment</h3>
            <p>{detailed?.overall_assessment ?? report.applicant_bio}</p>
            {detailed?.decisive_reasons.length ? <ul>{detailed.decisive_reasons.map(reason => <li key={reason}>{reason}</li>)}</ul> : null}
          </div>
          {detailed?.claim_assessments.length ? (
            <div style={{ display: "grid", gap: 12 }}>
              <h3 className={styles.groupTitle}>Evidence and interpretation</h3>
              {detailed.claim_assessments.map((claim, index) => (
                <div key={`${claim.claim}-${index}`} style={{ display: "grid", gap: 6 }}>
                  <span className={styles.muted}>{claim.assessment}</span>
                  <p>{claim.claim}</p>
                  <p className={styles.secondary}>{claim.interpretation}</p>
                  {quotes(claim.evidence_reference_ids).map(reference => <blockquote className={styles.quote} key={`${reference.source_message_id}-${reference.signal_key}`}>“{reference.excerpt}”</blockquote>)}
                </div>
              ))}
            </div>
          ) : null}
          {detailed?.likely_contribution ? <div><h3 className={styles.groupTitle}>Likely contribution</h3><p>{detailed.likely_contribution}</p></div> : null}
          {detailed?.reservations.length ? <div><h3 className={styles.groupTitle}>Reservations</h3>{detailed.reservations.map(reservation => (
            <div key={reservation.text}><p>{reservation.text}</p>{quotes(reservation.evidence_reference_ids).map(reference => <blockquote className={styles.quote} key={`${reference.source_message_id}-${reference.signal_key}`}>“{reference.excerpt}”</blockquote>)}</div>
          ))}</div> : null}
          {report.weak_or_missing_signals.length ? <div><h3 className={styles.groupTitle}>Decision-relevant gaps</h3><ul>{report.weak_or_missing_signals.map(gap => <li key={gap}>{gap}</li>)}</ul></div> : null}
          {report.safety_or_integrity_flags.length ? <div><h3 className={styles.groupTitle}>Source-linked concerns</h3><ul>{report.safety_or_integrity_flags.map(flag => <li key={flag}>{flag}</li>)}</ul></div> : null}
          {detailed?.reviewer_questions.length ? <div><h3 className={styles.groupTitle}>Questions for a reviewer</h3><ul>{detailed.reviewer_questions.map(question => <li key={question}>{question}</li>)}</ul></div> : null}
          <div style={{ display: "grid", gap: 8 }}>
            <h3 className={styles.groupTitle}>Source excerpts</h3>
            {report.evidence_references.map(reference => <blockquote className={styles.quote} key={`${reference.signal_key}-${reference.source_message_id}`}>
              <span className={styles.secondary}>{reference.signal_label}</span>
              <span>“{reference.excerpt}”</span>
            </blockquote>)}
          </div>
        </div>
      </details>
    </section>
  )
}
