"use client"

import { useEffect, useRef, useState } from "react"
import dashboard from "@/components/admin/dashboard/dashboard.module.css"
import { shortDate } from "@/lib/relative-time"
import styles from "./client.module.css"

export type CorrectableDecision = {
  id: string
  decision: "approved" | "declined"
  by: string
  reason: string | null
  decidedAt: string | null
}

/** Correct a decision: the old one stays in the history and the client's system is told. */
export function CorrectionDialog({
  open,
  applicantName,
  current,
  endpoint,
  onClose,
  onCorrected,
}: {
  open: boolean
  applicantName: string
  current: CorrectableDecision
  endpoint: string
  onClose: () => void
  onCorrected: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const [reason, setReason] = useState("")
  const [applicantReason, setApplicantReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const next = current.decision === "approved" ? "declined" : "approved"

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      requestAnimationFrame(() => reasonRef.current?.focus())
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  async function submit() {
    if (!reason.trim()) {
      setError("Add the reason for the correction. It stays with the history.")
      reasonRef.current?.focus()
      return
    }
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedDecisionId: current.id, decision: next, reason, applicantReason }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The correction could not be saved.")
      setReason("")
      setApplicantReason("")
      onCorrected()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The correction could not be saved.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <dialog ref={dialogRef} className={dashboard.dialog} style={{ width: "min(560px, calc(100vw - 32px))" }} onClose={onClose} aria-labelledby="correct-title">
      <form
        className={dashboard.dialogBody}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className={dashboard.dialogHeader}>
          <div>
            <h2 id="correct-title">Correct {applicantName}&apos;s decision</h2>
            <p>The current decision stays in the history. Your correction replaces it from now on.</p>
          </div>
        </div>

        <ol className={styles.timeline} style={{ padding: 0 }}>
          <li>
            <span className={`${styles.dot} ${current.decision === "approved" ? styles.dotSuccess : styles.dotDanger}`} aria-hidden="true" />
            <span>
              {current.decision === "approved" ? "Approved" : "Declined"} by {current.by}
              <span className={`${styles.muted} ${styles.small}`} style={{ display: "block" }}>
                {shortDate(current.decidedAt)}
                {current.reason ? ` · “${current.reason}”` : ""}
              </span>
            </span>
          </li>
          <li>
            <span className={`${styles.dot} ${styles.dotSelection}`} aria-hidden="true" />
            <span>
              Change to {next}
              <span className={`${styles.muted} ${styles.small}`} style={{ display: "block" }}>Now · by you</span>
            </span>
          </li>
        </ol>

        <label className={styles.field}>
          Why are you correcting this?
          <textarea ref={reasonRef} className={styles.textarea} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1200} required />
        </label>
        <label className={styles.field}>
          <span>
            Reason you can share with {applicantName} <span className={styles.muted}>· optional</span>
          </span>
          <textarea className={styles.textarea} value={applicantReason} onChange={(event) => setApplicantReason(event.target.value)} maxLength={1200} />
        </label>

        <div className={styles.consequences}>
          <strong>What happens</strong>
          <span>
            {next === "approved"
              ? "A new access secret is issued."
              : "Their access secret stops working."}
          </span>
          <span>
            Your system gets <span className={styles.mono}>application.decision_corrected</span>. What you tell {applicantName} is up to you.
          </span>
        </div>

        {error ? <p className={styles.errorText} role="alert">{error}</p> : null}

        <div className={dashboard.dialogActions}>
          <button type="button" className={styles.button} onClick={onClose}>Cancel</button>
          <button type="submit" className={styles.buttonPrimary} disabled={saving}>
            {saving ? "Saving…" : "Correct decision"}
          </button>
        </div>
      </form>
    </dialog>
  )
}
