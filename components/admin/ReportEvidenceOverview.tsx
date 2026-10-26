import { reviewerEvidenceLimits, type ReviewerEvidenceStateEntry } from "@/lib/reviewer-report"

export function ReportEvidenceOverview({ state }: { state?: ReviewerEvidenceStateEntry[] }) {
  if (!state?.length) return null
  const supported = state.filter(entry => entry.coverage === "supported")
  const limits = reviewerEvidenceLimits(state)
  const label = (key: string) => key.replaceAll("_", " ").replace(/^colors/, "COLORS").replace(/^tones/, "TONES")
  return (
    <section aria-label="Evidence coverage" className="my-4 border-t border-white/10 pt-4 text-xs leading-relaxed text-white/65">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="mb-2 font-normal text-white/85">Supported by their account</h4>
          {supported.length ? <ul className="m-0 list-disc space-y-1 pl-4">{supported.map(entry => <li key={entry.signal_key}>{label(entry.signal_key)}</li>)}</ul> : <p>No area is established yet.</p>}
        </div>
        <div>
          <h4 className="mb-2 font-normal text-white/85">Not established or unresolved</h4>
          {limits.length ? <ul className="m-0 space-y-2 pl-0">{limits.map(entry => <li key={entry.signal_key}>
            <span className="text-white/80">{entry.label}{entry.material_gap ? " — needs clarification" : ""}</span>
            {entry.material_gap ? <p className="m-0 text-white/50">{entry.explanation}</p> : null}
          </li>)}</ul> : <p>No remaining unknowns recorded for the reviewed areas.</p>}
        </div>
      </div>
      <p className="mb-0 mt-3 text-white/45">These are applicant accounts, not independently verified facts. Unknowns are neutral; an empty follow-up list does not mean complete knowledge.</p>
    </section>
  )
}
