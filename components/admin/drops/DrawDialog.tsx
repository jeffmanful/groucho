"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import dashboard from "@/components/admin/dashboard/dashboard.module.css"
import client from "@/components/admin/client/client.module.css"
import type { Cohort } from "@/lib/cohorts"
import { shortDate } from "@/lib/relative-time"
import styles from "./drops.module.css"
import { fieldLabel, nf } from "./useDropProject"

/** Draw winners from a locked cohort, once. Groucho records the locked list, the numbers and who ran it. */
export function DrawDialog({
  base,
  source,
  cohorts,
  fields,
  onClose,
  onDone,
}: {
  base: string
  source: Cohort
  cohorts: Cohort[]
  fields: string[]
  onClose: () => void
  onDone: (message: string) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const targets = useMemo(() => cohorts.filter((c) => c.id !== source.id && !c.lockedAt && !c.drawnAt), [cohorts, source.id])
  const hasRoom = (c: Cohort) => c.capacity === null || c.members < c.capacity
  const [targetId, setTargetId] = useState(
    targets.find((c) => c.grantsAccess && hasRoom(c) && c.members === 0)?.id ?? targets.find((c) => c.grantsAccess && hasRoom(c))?.id ?? targets.find(hasRoom)?.id ?? "",
  )
  const [restId, setRestId] = useState<string>("")
  const [byField, setByField] = useState<string | null>(null)
  const [count, setCount] = useState("")
  const [perValue, setPerValue] = useState<Record<string, string>>({})
  const [breakdown, setBreakdown] = useState<{ field: string; counts?: Record<string, number>; error?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const target = targets.find((c) => c.id === targetId) ?? null
  const room = target?.capacity != null ? target.capacity - target.members : null

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  useEffect(() => {
    if (!byField) return
    let cancelled = false
    fetch(`${base}/cohorts/${source.id}/members?breakdown=${encodeURIComponent(byField)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Counts could not be loaded.")
        if (!cancelled) setBreakdown({ field: byField, counts: body.breakdown as Record<string, number> })
      })
      .catch((problem: Error) => {
        if (!cancelled) setBreakdown({ field: byField, error: problem.message })
      })
    return () => {
      cancelled = true
    }
  }, [base, byField, source.id])

  const counts = breakdown?.field === byField ? breakdown?.counts : undefined
  const values = Object.keys(counts ?? {}).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const winners = byField
    ? values.reduce((sum, value) => sum + Math.min(Number.parseInt(perValue[value] ?? "", 10) || 0, counts?.[value] ?? 0), 0)
    : Math.min(Number.parseInt(count, 10) || 0, source.members)
  const overRoom = room !== null && winners > room
  const restName = cohorts.find((c) => c.id === restId)?.name

  async function draw() {
    setBusy(true)
    setError(null)
    try {
      const body = byField
        ? { targetId, restId: restId || null, byField, perValue: Object.fromEntries(values.map((v) => [v, Number.parseInt(perValue[v] ?? "", 10) || 0])) }
        : { targetId, restId: restId || null, count: Number.parseInt(count, 10) }
      const response = await fetch(`${base}/cohorts/${source.id}/draw`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "The draw didn't run.")
      onDone(`Drew ${nf.format(Number(result.winners))} winners into ${target?.name}${Number(result.rest) ? ` and put ${nf.format(Number(result.rest))} in ${restName}` : ""}.`)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The draw didn't run.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} className={`${dashboard.dialog} ${styles.dialogMedium}`} onClose={onClose} aria-labelledby="draw-title">
      <form
        className={dashboard.dialogBody}
        onSubmit={(event) => {
          event.preventDefault()
          void draw()
        }}
      >
        <div className={dashboard.dialogHeader}>
          <div>
            <h2 id="draw-title">Draw winners from {source.name}</h2>
            <p>
              {nf.format(source.members)} people, locked {shortDate(source.lockedAt)}
              {source.lockedBy ? ` by ${source.lockedBy}` : ""}.
            </p>
          </div>
        </div>

        {targets.length ? (
          <label className={styles.label}>
            Winners go to
            <select className={styles.select} value={targetId} onChange={(event) => setTargetId(event.target.value)}>
              {targets.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.grantsAccess ? "Grants access" : "No access"}
                  {c.capacity !== null ? ` · ${nf.format(c.capacity - c.members)} places left` : ""}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className={client.errorText}>Create a cohort for the winners first, such as “Ballot winners”.</p>
        )}

        <fieldset style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 8 }}>
          <legend className={client.secondary} style={{ marginBottom: 8 }}>How many</legend>
          <div className={styles.options} style={{ "--count": 2 } as React.CSSProperties}>
            <label className={styles.option}>
              <input type="radio" name="draw-mode" checked={!byField} onChange={() => setByField(null)} />
              <span>
                <span>One draw</span>
                <span className={`${client.muted} ${client.small}`}>Winners from everyone</span>
              </span>
            </label>
            <label className={styles.option}>
              <input type="radio" name="draw-mode" checked={Boolean(byField)} disabled={!fields.length} onChange={() => setByField(fields.includes("size") ? "size" : fields[0])} />
              <span>
                <span>By {fields.length ? fieldLabel(fields.includes("size") ? "size" : fields[0]).toLowerCase() : "field"}</span>
                <span className={`${client.muted} ${client.small}`}>{fields.length ? "A separate draw for each value" : "No drop fields"}</span>
              </span>
            </label>
          </div>
        </fieldset>

        {!byField ? (
          <label className={styles.inline}>
            <span className={client.secondary}>Winners</span>
            <input className={`${styles.input} ${styles.numberInput}`} type="number" min={1} max={source.members} value={count} onChange={(event) => setCount(event.target.value)} required />
            <span className={client.muted}>of {nf.format(source.members)}</span>
          </label>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {fields.length > 1 ? (
              <select className={styles.select} value={byField} onChange={(event) => setByField(event.target.value)} aria-label="Draw by" style={{ justifySelf: "start" }}>
                {fields.map((key) => (
                  <option key={key} value={key}>{fieldLabel(key)}</option>
                ))}
              </select>
            ) : null}
            {breakdown?.error ? <p className={client.errorText}>{breakdown.error}</p> : null}
            <div className={client.panel}>
              <div className={`${styles.row} ${styles.rowHead}`} style={{ "--columns": "1fr 1fr 120px" } as React.CSSProperties}>
                <span>{fieldLabel(byField)}</span>
                <span>In the pool</span>
                <span>Winners</span>
              </div>
              {counts
                ? values.map((value) => (
                    <div key={value} className={styles.row} style={{ "--columns": "1fr 1fr 120px", minHeight: 44 } as React.CSSProperties}>
                      <span className={client.mono}>{value}</span>
                      <span className={`${client.mono} ${client.secondary}`}>{nf.format(counts[value])}</span>
                      <input
                        className={`${styles.input} ${styles.numberInput}`}
                        type="number"
                        min={0}
                        max={counts[value]}
                        value={perValue[value] ?? ""}
                        onChange={(event) => setPerValue((current) => ({ ...current, [value]: event.target.value }))}
                        aria-label={`Winners for ${value}`}
                      />
                    </div>
                  ))
                : <div className={`${styles.row} ${client.muted}`} style={{ "--columns": "1fr" } as React.CSSProperties}>Counting…</div>}
              <div className={styles.row} style={{ "--columns": "1fr 1fr 120px", minHeight: 44 } as React.CSSProperties}>
                <span>Total</span>
                <span className={`${client.mono} ${client.secondary}`}>{nf.format(source.members)}</span>
                <span className={client.mono}>{nf.format(winners)}</span>
              </div>
            </div>
          </div>
        )}

        <label className={styles.label}>
          Everyone else
          <select className={styles.select} value={restId} onChange={(event) => setRestId(event.target.value)}>
            <option value="">Stays in {source.name}</option>
            {targets.filter((c) => c.id !== targetId).map((c) => (
              <option key={c.id} value={c.id}>
                Goes to {c.name}, in draw order
              </option>
            ))}
          </select>
          {restId && byField ? <span className={`${client.muted} ${client.small}`}>Each {fieldLabel(byField).toLowerCase()} keeps its own order.</span> : null}
        </label>

        <div className={styles.note}>
          <strong>This draw can’t be run again</strong>
          <span>Every entry has one equal chance. Groucho picks without replacement using secure randomness, and records the locked list, the numbers and who ran it.</span>
          {overRoom ? <span style={{ color: "var(--danger)" }}>{target?.name} has {nf.format(room ?? 0)} places left.</span> : null}
        </div>

        {error ? <p className={client.errorText} role="alert">{error}</p> : null}

        <div className={dashboard.dialogActions}>
          <a className={client.button} href={`${base}/cohorts/${source.id}/export`}>
            Export pool instead
          </a>
          <button type="button" className={client.button} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={client.buttonPrimary} disabled={busy || !target || winners < 1 || overRoom}>
            {busy ? "Drawing…" : `Draw ${nf.format(winners)} ${winners === 1 ? "winner" : "winners"}`}
          </button>
        </div>
      </form>
    </dialog>
  )
}
