"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import dashboard from "@/components/admin/dashboard/dashboard.module.css"
import client from "@/components/admin/client/client.module.css"
import type { Cohort } from "@/lib/cohorts"
import type { EntryItem } from "@/lib/entry-review"
import { shortDate } from "@/lib/relative-time"
import styles from "./drops.module.css"
import { nf } from "./useDropProject"

export function CohortDrawer({ base, cohort, canManage, onClose, onMove, onRemoved }: { base: string; cohort: Cohort; canManage: boolean; onClose: () => void; onMove: () => void; onRemoved: (message: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const cancelRemoval = useRef<HTMLButtonElement>(null)
  const [offset, setOffset] = useState(0)
  const [reload, setReload] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [removing, setRemoving] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [state, setState] = useState<{ offset: number; entries?: Array<EntryItem & { position: number | null }>; total?: number; error?: string } | null>(null)
  useEffect(() => {
    if (removing) cancelRemoval.current?.focus()
  }, [removing])
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  useEffect(() => {
    let cancelled = false
    fetch(`${base}/cohorts/${cohort.id}/members?offset=${offset}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Members could not be loaded.")
        if (!cancelled) setState({ offset, entries: body.entries, total: body.total })
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ offset, error: error.message })
      })
    return () => {
      cancelled = true
    }
  }, [base, cohort.id, offset, reload])
  const total = state?.total ?? cohort.members
  const editable = canManage && !cohort.lockedAt
  const entries = state?.entries ?? []
  const allSelected = entries.length > 0 && entries.every((entry) => selected.has(entry.id))
  const fieldKeys = [...new Set((state?.entries ?? []).flatMap((entry) => Object.keys(entry.fields)))].slice(0, 2)
  const columns = { "--columns": `${editable ? "40px" : "32px"} minmax(0,1fr) ${editable ? "auto" : ""}`, minHeight: 56 } as CSSProperties

  function changePage(next: number) {
    setState(null)
    setSelected(new Set())
    setRemoving(null)
    setError(null)
    setOffset(next)
  }

  async function remove() {
    if (!removing?.length || busy || !editable) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`${base}/cohorts/fill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: cohort.id, target: null, mode: "select", sessionIds: removing }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Applicants could not be removed. Try again.")
      const moved = Number(body.moved ?? 0)
      const message = `${nf.format(moved)} ${moved === 1 ? "applicant" : "applicants"} removed from ${cohort.name}.`
      setNotice(message)
      setSelected(new Set())
      setRemoving(null)
      setState(null)
      // Keep the last page in range when its remaining members were removed.
      setOffset(Math.min(offset, Math.max(0, Math.ceil((total - moved) / 100) - 1) * 100))
      setReload((value) => value + 1)
      onRemoved(message)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Applicants could not be removed. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} className={`${dashboard.dialog} ${styles.drawer}`} onClose={onClose} onCancel={(event) => { if (busy) event.preventDefault() }} aria-labelledby="drawer-title">
      <div className={dashboard.dialogBody}>
        <div className={dashboard.dialogHeader}>
          <div>
            <h2 id="drawer-title">{cohort.name}</h2>
            <p>
              {nf.format(total)} {total === 1 ? "person" : "people"}
              {cohort.capacity !== null ? ` of ${nf.format(cohort.capacity)} places` : ""} · {cohort.grantsAccess ? "Grants access" : "No access"}
              {cohort.lockedAt ? ` · Locked ${shortDate(cohort.lockedAt)}` : ""}
            </p>
          </div>
          <button type="button" className={client.buttonGhost} onClick={onClose} disabled={busy} aria-label="Close">
            ×
          </button>
        </div>
        <div className={styles.inline}>
          {cohort.members ? (
            <a className={client.button} href={`${base}/cohorts/${cohort.id}/export`}>
              Export CSV
            </a>
          ) : null}
          {canManage && cohort.members && !cohort.lockedAt ? (
            <button type="button" className={client.button} onClick={onMove} disabled={busy}>
              Move people…
            </button>
          ) : null}
        </div>
        {canManage && cohort.lockedAt ? <p className={client.muted}>Unlock this cohort to remove applicants.</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
        {editable && entries.length > 0 ? (
          <div className={styles.memberToolbar}>
            <label className={styles.memberSelect}>
              <input type="checkbox" className={styles.check} checked={allSelected} ref={(input) => { if (input) input.indeterminate = selected.size > 0 && !allSelected }} disabled={busy || !!removing} onChange={() => setSelected(allSelected ? new Set() : new Set(entries.map((entry) => entry.id)))} />
              Select this page
            </label>
            {selected.size > 0 ? (
              <button type="button" className={client.button} disabled={busy || !!removing} onClick={() => { setError(null); setRemoving([...selected]) }}>
                Remove selected ({nf.format(selected.size)})
              </button>
            ) : null}
          </div>
        ) : null}
        {removing ? (
          <div className={styles.removalConfirm} role="group" aria-labelledby="remove-title">
            <strong id="remove-title">Remove {removing.length === 1 ? entries.find((entry) => entry.id === removing[0])?.name ?? entries.find((entry) => entry.id === removing[0])?.email ?? "this applicant" : `${nf.format(removing.length)} applicants`} from {cohort.name}?</strong>
            <p>They’ll return to Unallocated and stay approved.{cohort.grantsAccess ? " Any access granted by this cohort will be removed." : ""}</p>
            {error ? <p className={client.errorText} role="alert">{error}</p> : null}
            <div className={styles.inline}>
              <button type="button" className={client.button} disabled={busy} onClick={() => void remove()}>{busy ? "Removing…" : "Confirm removal"}</button>
              <button ref={cancelRemoval} type="button" className={client.buttonGhost} disabled={busy} onClick={() => { setRemoving(null); setError(null) }}>Cancel</button>
            </div>
          </div>
        ) : null}
        {state?.error ? <p className={client.errorText} role="alert">{state.error}</p> : null}
        <div className={client.panel} aria-busy={!state}>
          {!state ? <p className={styles.memberLoading} role="status">Loading applicants…</p> : null}
          {(state?.entries ?? []).map((entry, index) => (
            <div key={entry.id} className={styles.row} style={columns}>
              {editable ? (
                <label className={styles.memberSelect}>
                  <input type="checkbox" className={styles.check} aria-label={`Select ${entry.name ?? entry.email}`} checked={selected.has(entry.id)} disabled={busy || !!removing} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); return next })} />
                </label>
              ) : <span className={`${client.mono} ${client.muted}`}>{entry.position ?? offset + index + 1}</span>}
              <span className={client.person}>
                <span className={client.truncate}>{entry.name ?? entry.email}</span>
                {entry.name ? <span className={`${client.muted} ${client.small} ${client.truncate}`}>{entry.email}</span> : null}
                <span className={`${client.muted} ${client.small}`}>{fieldKeys.map((key) => entry.fields[key]).filter(Boolean).join(" · ") || shortDate(entry.createdAt)}</span>
              </span>
              {editable ? <button type="button" className={`${client.buttonGhost} ${styles.memberRemove}`} aria-label={`Remove ${entry.name ?? entry.email} from ${cohort.name}`} disabled={busy || !!removing} onClick={() => { setError(null); setRemoving([entry.id]) }}>Remove</button> : null}
            </div>
          ))}
          {state?.entries && !state.entries.length ? <p className={client.muted} style={{ margin: 0, padding: "18px 16px" }}>Nobody here yet.</p> : null}
        </div>
        {total > 100 ? (
          <div className={styles.footer}>
            <span className={client.muted}>
              {nf.format(offset + 1)}–{nf.format(Math.min(offset + 100, total))} of {nf.format(total)}
            </span>
            <span>
              <button type="button" className={client.button} disabled={offset === 0 || busy || !state} onClick={() => changePage(Math.max(0, offset - 100))}>
                Previous
              </button>
              <button type="button" className={client.button} disabled={offset + 100 >= total || busy || !state} onClick={() => changePage(offset + 100)}>
                Next
              </button>
            </span>
          </div>
        ) : null}
      </div>
    </dialog>
  )
}
