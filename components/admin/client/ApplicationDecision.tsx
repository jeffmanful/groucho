"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ArrowLeft } from "lucide-react"
import { useOrganisationSummary } from "@/components/admin/dashboard/OrganisationSummaryContext"
import dashboard from "@/components/admin/dashboard/dashboard.module.css"
import type { ApplicationItem } from "@/lib/applications-source"
import type { DecisionHistoryEntry, OutcomeRecord } from "@/lib/application-outcomes"
import { OUTCOME_LABELS } from "@/lib/outcome-labels"
import { shortDate } from "@/lib/relative-time"
import type { ReviewerReport } from "@/lib/reviewer-report"
import { CorrectionDialog } from "./CorrectionDialog"
import styles from "./client.module.css"

type Loaded = {
  application: ApplicationItem
  project: { id: string; name: string }
  permissions: { canDecide: boolean; canCorrect: boolean }
}
type Detail = {
  messages: Array<{ id: string; role: "user" | "assistant"; content: string; sent_at?: string }>
  reviewerReport: ReviewerReport | null
}
type History = {
  decisions: DecisionHistoryEntry[]
  outcomes: OutcomeRecord[]
  earlierApplications: Array<{ id: string; created_at: string; queue: string; decision: string | null; decision_reason: string | null; decided_at: string | null }>
}

const RECOMMENDATION = {
  recommend: { label: "Recommended", dot: styles.dotSuccess },
  human_review: { label: "Review", dot: styles.dotWarning },
  decline: { label: "Below threshold", dot: styles.dotDanger },
} as const
const BAND = {
  recommended_acceptance: "Your rules put this in the recommended band",
  review: "Your rules send this to review",
  below_threshold: "Below your review threshold",
} as const

function reviewerLabel(entry: { via: string; reviewerEmail: string | null; reviewerName: string | null }): string {
  if (entry.via === "policy") return "your rules"
  const who = entry.reviewerName ?? entry.reviewerEmail ?? "a reviewer"
  return entry.via === "api" ? `${who} in your app` : `${who} in the dashboard`
}

/** Decisions and reported outcomes in the order they happened. */
function timeline(history: History) {
  return [
    ...history.decisions.map((entry) => ({ kind: "decision" as const, at: entry.decidedAt, entry })),
    ...history.outcomes.map((outcome) => ({ kind: "outcome" as const, at: outcome.occurred_at, outcome })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

function firstName(name: string): string {
  return name.split(/\s+/)[0] || name
}

export function ApplicationDecision({ projectId, sessionId }: { projectId: string; sessionId: string }) {
  const { orgId, refresh } = useOrganisationSummary()
  const base = `/api/admin/organisations/${orgId}/projects/${projectId}`
  const [token, setToken] = useState(0)
  const [loaded, setLoaded] = useState<{ key: string; value?: Loaded; error?: string } | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [history, setHistory] = useState<History | null>(null)
  const [choice, setChoice] = useState<"approved" | "declined" | null>(null)
  const [note, setNote] = useState("")
  const [shareable, setShareable] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [correcting, setCorrecting] = useState(false)
  const key = `${orgId}|${projectId}|${sessionId}|${token}`

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    const get = async <T,>(path: string): Promise<T> => {
      const response = await fetch(path, { cache: "no-store" })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "This application could not be loaded.")
      return body as T
    }
    Promise.all([
      get<Loaded>(`${base}/applications/${sessionId}`),
      get<Detail>(`${base}/sessions/${sessionId}/messages`).catch(() => null),
      get<History>(`${base}/sessions/${sessionId}/history`).catch(() => null),
    ])
      .then(([value, nextDetail, nextHistory]) => {
        if (cancelled) return
        setLoaded({ key, value })
        setDetail(nextDetail)
        setHistory(nextHistory)
      })
      .catch((problem: Error) => {
        if (!cancelled) setLoaded({ key, error: problem.message })
      })
    return () => {
      cancelled = true
    }
  }, [orgId, base, sessionId, key])

  const value = loaded?.value
  const application = value?.application
  const name = application?.applicant.name ?? application?.applicant.email ?? "Applicant"
  const report = detail?.reviewerReport ?? null
  const recommendation = application?.assessment.recommendation ? RECOMMENDATION[application.assessment.recommendation] : null
  const decidable = application && !application.decision && (application.queue === "ready_for_review" || application.queue === "awaiting_assessment")
  const currentEntry = history?.decisions.find((entry) => entry.current) ?? null

  async function decide() {
    if (!choice) return
    if (choice === "declined" && !note.trim()) {
      setError("Add a note for your team before declining. It stays with the decision.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`${base}/sessions/${sessionId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: choice, reason: note, applicantReason: shareable }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The decision could not be saved.")
      setChoice(null)
      setNote("")
      setShareable("")
      setToken((current) => current + 1)
      refresh()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The decision could not be saved.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={dashboard.page}>
      <div className={styles.backRow}>
        <Link className={styles.backLink} href={`/admin/organisations/${orgId}/needs-you`}>
          <ArrowLeft size={14} aria-hidden="true" /> Needs you
        </Link>
        {value ? <span className={styles.muted}>{value.project.name}</span> : null}
      </div>

      {loaded?.error ? <p className={dashboard.error} role="alert">{loaded.error}</p> : null}
      {!application && !loaded?.error ? <div className={dashboard.skeleton} style={{ height: 320 }} aria-label="Loading" /> : null}

      {application && value ? (
        <div className={styles.layout}>
          <div className={styles.mainColumn}>
            <div style={{ display: "grid", gap: 6 }}>
              <h1 className={styles.name}>{name}</h1>
              <span className={styles.secondary}>
                {[
                  application.applicant.name ? application.applicant.email : null,
                  application.applicant.city,
                  application.applicant.audience === "artist" ? application.applicant.artistName ?? "artist" : "community",
                  `applied ${shortDate(application.createdAt)}`,
                ].filter(Boolean).join(" · ")}
              </span>
            </div>

            <div className={`${styles.panel} ${styles.summary}`}>
              <div className={styles.assessmentLine}>
                {recommendation ? (
                  <span className={styles.badge}>
                    <span className={`${styles.dot} ${recommendation.dot}`} aria-hidden="true" />
                    {recommendation.label}
                  </span>
                ) : (
                  <span className={styles.badge}>Not assessed yet</span>
                )}
                {application.assessment.suitabilityScore !== null ? (
                  <span className={`${styles.mono} ${styles.secondary}`}>{Number(application.assessment.suitabilityScore).toFixed(2)}</span>
                ) : null}
                {application.assessment.suitabilityBand ? (
                  <span className={styles.muted}>{BAND[application.assessment.suitabilityBand]}</span>
                ) : null}
              </div>
              {report?.applicant_bio ? <p>{report.applicant_bio}</p> : null}
            </div>

            {report && (report.evidence_references.length || report.reviewer_focus) ? (
              <section style={{ display: "grid", gap: 12 }} aria-labelledby="said">
                <h2 id="said" className={styles.groupTitle}>What they said</h2>
                <div className={styles.panel}>
                  {report.evidence_references.slice(0, 5).map((reference) => (
                    <div key={`${reference.signal_key}-${reference.source_message_id}`} className={styles.quote}>
                      <span className={styles.secondary}>{reference.signal_label}</span>
                      <span>“{reference.excerpt}”</span>
                    </div>
                  ))}
                  {report.reviewer_focus ? (
                    <div className={styles.quote}>
                      <span className={styles.secondary}>Worth checking</span>
                      <span className={styles.secondary}>{report.reviewer_focus}</span>
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {detail?.messages.length ? (
              <details className={styles.details}>
                <summary>Read the conversation</summary>
                <div className={`${styles.panel} ${styles.transcript}`} style={{ marginTop: 12 }}>
                  {detail.messages.map((message) => (
                    <div key={message.id} style={{ display: "grid", gap: 2 }}>
                      <span className={`${styles.muted} ${styles.small}`}>{message.role === "user" ? name : "Groucho"}</span>
                      <p>{message.content}</p>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}

            {history && (history.decisions.length || history.outcomes.length || history.earlierApplications.length) ? (
              <section style={{ display: "grid", gap: 12 }} aria-labelledby="history">
                <h2 id="history" className={styles.groupTitle}>History</h2>
                <div className={styles.panel}>
                  <ol className={styles.timeline}>
                    {history.earlierApplications.map((earlier) => (
                      <li key={earlier.id}>
                        <span className={styles.dot} aria-hidden="true" />
                        <span>
                          Earlier application, {earlier.decision ?? earlier.queue.replaceAll("_", " ")}
                          <span className={`${styles.muted} ${styles.small}`} style={{ display: "block" }}>
                            {shortDate(earlier.created_at)}
                            {earlier.decision_reason ? ` · “${earlier.decision_reason}”` : ""}
                          </span>
                        </span>
                      </li>
                    ))}
                    {timeline(history).map((item) =>
                      item.kind === "decision" ? (
                        <li key={item.entry.id}>
                          <span className={`${styles.dot} ${item.entry.decision === "approved" ? styles.dotSuccess : styles.dotDanger}`} aria-hidden="true" />
                          <span style={{ opacity: item.entry.current ? 1 : 0.7 }}>
                            {item.entry.correction ? "Corrected to " : ""}
                            {item.entry.correction ? item.entry.decision : item.entry.decision === "approved" ? "Approved" : "Declined"} by {reviewerLabel(item.entry)}
                            {!item.entry.current ? <span className={styles.muted}> · replaced</span> : null}
                            <span className={`${styles.muted} ${styles.small}`} style={{ display: "block" }}>{shortDate(item.entry.decidedAt)}</span>
                            {item.entry.reason ? <blockquote>{item.entry.reason}</blockquote> : null}
                            {item.entry.applicantReason ? (
                              <span className={`${styles.secondary} ${styles.small}`} style={{ display: "block", marginTop: 4 }}>
                                Shareable: “{item.entry.applicantReason}”
                              </span>
                            ) : null}
                          </span>
                        </li>
                      ) : (
                        <li key={item.outcome.id}>
                          <span className={`${styles.dot} ${styles.dotSelection}`} aria-hidden="true" />
                          <span>
                            {OUTCOME_LABELS[item.outcome.outcome] ?? item.outcome.outcome}
                            <span className={`${styles.muted} ${styles.small}`} style={{ display: "block" }}>
                              Reported by your system · {shortDate(item.outcome.occurred_at)}
                              {item.outcome.note ? ` · ${item.outcome.note}` : ""}
                            </span>
                          </span>
                        </li>
                      ),
                    )}
                  </ol>
                </div>
              </section>
            ) : null}
          </div>

          <aside className={styles.aside}>
            {application.decision ? (
              <div className={`${styles.panel} ${styles.decisionPanel}`}>
                <h2>Decision</h2>
                <span className={styles.status}>
                  <span className={`${styles.dot} ${application.decision.decision === "approved" ? styles.dotSuccess : styles.dotDanger}`} aria-hidden="true" />
                  {application.decision.decision === "approved" ? "Approved" : "Declined"}
                  {application.decision.corrected ? <span className={styles.badge}>Corrected</span> : null}
                </span>
                <span className={styles.secondary}>
                  {currentEntry ? `By ${reviewerLabel(currentEntry)}` : application.decision.via === "policy" ? "By your rules" : `By ${application.decision.reviewer ?? "a reviewer"}`}
                  {" · "}
                  {shortDate(application.decision.decidedAt)}
                </span>
                {application.latestOutcome &&
                (!application.latestOutcome.at || !application.decision.decidedAt || Date.parse(application.latestOutcome.at) >= Date.parse(application.decision.decidedAt)) ? (
                  <span className={styles.secondary}>
                    Since then: {OUTCOME_LABELS[application.latestOutcome.outcome as keyof typeof OUTCOME_LABELS] ?? application.latestOutcome.outcome}
                  </span>
                ) : null}
                {value.permissions.canCorrect && application.decision.id ? (
                  <button type="button" className={`${styles.button} ${styles.tall}`} onClick={() => setCorrecting(true)}>
                    Correct decision
                  </button>
                ) : (
                  <span className={`${styles.muted} ${styles.small}`}>
                    Corrections come from your organisation&apos;s owners and admins.
                  </span>
                )}
              </div>
            ) : decidable && application.queue === "ready_for_review" && value.permissions.canDecide ? (
              <form
                className={`${styles.panel} ${styles.decisionPanel}`}
                onSubmit={(event) => {
                  event.preventDefault()
                  void decide()
                }}
              >
                <h2>Your decision</h2>
                <div className={styles.choiceRow} role="radiogroup" aria-label="Decision">
                  {(["approved", "declined"] as const).map((option) => (
                    <button key={option} type="button" role="radio" aria-checked={choice === option} onClick={() => setChoice(option)}>
                      {option === "approved" ? "Approve" : "Decline"}
                    </button>
                  ))}
                </div>
                <label className={styles.field}>
                  <span>
                    Note for your team{choice === "declined" ? "" : <span className={styles.muted}> · optional</span>}
                  </span>
                  <textarea className={styles.textarea} value={note} onChange={(event) => setNote(event.target.value)} maxLength={1200} />
                </label>
                <label className={styles.field}>
                  <span>
                    Reason you can share with {firstName(name)} <span className={styles.muted}>· optional</span>
                  </span>
                  <textarea className={styles.textarea} value={shareable} onChange={(event) => setShareable(event.target.value)} maxLength={1200} />
                </label>
                {error ? <p className={styles.errorText} role="alert">{error}</p> : null}
                <button type="submit" className={`${styles.buttonPrimary} ${styles.tall}`} disabled={!choice || saving}>
                  {saving ? "Saving…" : choice === "declined" ? `Decline ${firstName(name)}` : choice === "approved" ? `Approve ${firstName(name)}` : "Choose approve or decline"}
                </button>
                <span className={`${styles.muted} ${styles.small}`}>
                  Your system gets the decision and contacts {firstName(name)}. Groucho won&apos;t.
                </span>
              </form>
            ) : (
              <div className={`${styles.panel} ${styles.decisionPanel}`}>
                <h2>Decision</h2>
                <span className={styles.secondary}>
                  {application.queue === "in_progress"
                    ? "This conversation is still going."
                    : application.queue === "abandoned"
                      ? "The applicant left before finishing."
                      : application.queue === "awaiting_assessment"
                        ? "Waiting for Groucho's assessment."
                        : "Only your organisation's owners and admins can decide."}
                </span>
              </div>
            )}
          </aside>
        </div>
      ) : null}

      {application?.decision?.id ? (
        <CorrectionDialog
          open={correcting}
          applicantName={firstName(name)}
          current={{
            id: application.decision.id,
            decision: application.decision.decision,
            by: currentEntry ? reviewerLabel(currentEntry) : application.decision.reviewer ?? "a reviewer",
            reason: application.decision.reason,
            decidedAt: application.decision.decidedAt,
          }}
          endpoint={`${base}/sessions/${sessionId}/decision/correction`}
          onClose={() => setCorrecting(false)}
          onCorrected={() => {
            setCorrecting(false)
            setToken((current) => current + 1)
            refresh()
          }}
        />
      ) : null}
    </div>
  )
}
