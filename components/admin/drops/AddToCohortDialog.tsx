"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import dashboard from "@/components/admin/dashboard/dashboard.module.css"
import client from "@/components/admin/client/client.module.css"
import type { Cohort, CohortsOverview, FillMode } from "@/lib/cohorts"
import type { EntryItem } from "@/lib/entry-review"
import { shortDate } from "@/lib/relative-time"
import styles from "./drops.module.css"
import { fieldLabel, nf } from "./useDropProject"

type Preview = { count: number; available: number; sample: EntryItem[] }

const WHO: Array<{ value: FillMode; label: string; detail: (n: number) => string }> = [
  { value: "everyone", label: "Everyone", detail: (n) => `All ${nf.format(n)}` },
  { value: "filter", label: "Matching", detail: () => "A filter" },
  { value: "random", label: "At random", detail: () => "A number you set" },
  { value: "score", label: "Top by score", detail: () => "Highest first" },
  { value: "select", label: "Choose", detail: () => "Pick by hand" },
]

function targetState(cohort: Cohort): { disabled: boolean; detail: string } {
  if (cohort.lockedAt) return { disabled: true, detail: "Locked · unlock to add" }
  if (cohort.drawnAt) return { disabled: true, detail: "Filled by a draw" }
  if (cohort.capacity !== null && cohort.members >= cohort.capacity) {
    return { disabled: true, detail: `Full · ${nf.format(cohort.members)} of ${nf.format(cohort.capacity)}` }
  }
  const access = cohort.grantsAccess ? "Grants access" : "No access"
  const people = cohort.capacity !== null ? `${nf.format(cohort.members)} of ${nf.format(cohort.capacity)}` : `${nf.format(cohort.members)} people`
  return { disabled: false, detail: `${access} · ${people}` }
}

/**
 * Move people into a cohort. From the Cohorts page the source is Unallocated or a cohort and the rule
 * is chosen here; from Entries the people are already picked (`source="any"` with sessionIds).
 */
export function AddToCohortDialog({
  orgId,
  projectId,
  source,
  sessionIds,
  initialTarget,
  onClose,
  onDone,
}: {
  orgId: string
  projectId: string
  source: string
  sessionIds?: string[]
  initialTarget?: string | null
  onClose: () => void
  onDone: (message: string) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const base = `/api/admin/organisations/${orgId}/projects/${projectId}`
  const [overview, setOverview] = useState<CohortsOverview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const picked = source === "any"
  const [target, setTarget] = useState<string | null | undefined>(initialTarget)
  const [mode, setMode] = useState<FillMode>(picked ? "select" : "everyone")
  const [field, setField] = useState<string>("")
  const [values, setValues] = useState<string[]>([])
  const [count, setCount] = useState<string>("")
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [reason, setReason] = useState("")
  const [preview, setPreview] = useState<{ key: string; value?: Preview; error?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch(`${base}/cohorts`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Cohorts could not be loaded.")
        if (!cancelled) {
          const data = body as CohortsOverview
          setOverview(data)
          const keys = Object.keys(data.fields)
          setField((current) => current || (keys.includes("size") ? "size" : keys[0] ?? ""))
        }
      })
      .catch((problem: Error) => {
        if (!cancelled) setLoadError(problem.message)
      })
    return () => {
      cancelled = true
    }
  }, [base, reload])

  const cohorts = useMemo(() => (overview?.cohorts ?? []).filter((cohort) => cohort.id !== source), [overview, source])
  const sourceCohort = overview?.cohorts.find((cohort) => cohort.id === source) ?? null
  const sourceName = picked ? "your selection" : source === "unallocated" ? "Unallocated" : sourceCohort?.name ?? "this cohort"
  const sourceCount = picked ? sessionIds?.length ?? 0 : source === "unallocated" ? overview?.unallocated ?? 0 : sourceCohort?.members ?? 0
  const targetCohort = cohorts.find((cohort) => cohort.id === target) ?? null
  const fieldKeys = Object.keys(overview?.fields ?? {})
  const numericCount = Number.parseInt(count, 10)

  const request = useMemo(() => {
    const body: Record<string, unknown> = { source, target: target ?? null, mode }
    if (picked) body.sessionIds = sessionIds ?? []
    else if (mode === "select") body.sessionIds = [...chosen]
    if (mode === "filter" || ((mode === "random" || mode === "score") && values.length)) {
      if (field && values.length) {
        body.field = field
        body.values = values
      }
    }
    if (mode === "random" || mode === "score") body.count = Number.isInteger(numericCount) ? numericCount : 0
    return body
  }, [source, target, mode, picked, sessionIds, chosen, field, values, numericCount])
  const choosing = !picked && mode === "select"
  const ready =
    target !== undefined &&
    (mode !== "filter" || values.length > 0) &&
    (!choosing || chosen.size > 0) &&
    ((mode !== "random" && mode !== "score") || (Number.isInteger(numericCount) && numericCount > 0))
  const previewKey = JSON.stringify(request)

  useEffect(() => {
    if (!ready || mode === "random" || choosing) return
    let cancelled = false
    const timer = setTimeout(() => {
      fetch(`${base}/cohorts/fill`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...request, preview: true }) })
        .then(async (response) => {
          const body = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Preview failed.")
          if (!cancelled) setPreview({ key: previewKey, value: body as Preview })
        })
        .catch((problem: Error) => {
          if (!cancelled) setPreview({ key: previewKey, error: problem.message })
        })
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [base, ready, mode, choosing, request, previewKey])

  const shown = preview?.key === previewKey ? preview : null
  // A random pick isn't previewed (it would differ from the real one); the count is what you asked for.
  const moving = mode === "random" ? Math.min(numericCount || 0, sourceCount) : choosing ? chosen.size : shown?.value?.count ?? null
  const room = targetCohort?.capacity != null ? targetCohort.capacity - targetCohort.members : null
  const overCapacity = room !== null && moving !== null && moving > room
  const targetLabel = target === null ? "Unallocated" : targetCohort?.name ?? "a cohort"

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`${base}/cohorts/fill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, reason: reason.trim() || null }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "People could not be moved.")
      onDone(`${nf.format(Number(body.moved ?? 0))} ${Number(body.moved) === 1 ? "person" : "people"} moved to ${targetLabel}.`)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "People could not be moved.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} className={`${dashboard.dialog} ${styles.dialogWide}`} onClose={onClose} aria-labelledby="add-title">
      <form
        className={dashboard.dialogBody}
        onSubmit={(event) => {
          event.preventDefault()
          void confirm()
        }}
      >
        <div className={dashboard.dialogHeader}>
          <div>
            <h2 id="add-title">{target === null ? "Take people out of cohorts" : "Add to a cohort"}</h2>
            <p>
              From <span style={{ color: "var(--foreground)" }}>{picked ? `${nf.format(sourceCount)} selected` : sourceName}</span>
              {picked ? "" : ` · ${nf.format(sourceCount)} approved ${sourceCount === 1 ? "person" : "people"}`}
            </p>
          </div>
        </div>

        {loadError ? <p className={client.errorText} role="alert">{loadError}</p> : null}

        <fieldset style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 8 }}>
          <legend className={client.secondary} style={{ marginBottom: 8 }}>Into</legend>
          <div className={styles.options} style={{ "--count": 3 } as React.CSSProperties}>
            {cohorts.map((cohort) => {
              const state = targetState(cohort)
              return (
                <label key={cohort.id} className={styles.option}>
                  <input type="radio" name="target" checked={target === cohort.id} disabled={state.disabled} onChange={() => setTarget(cohort.id)} />
                  <span>
                    <span className={client.truncate}>{cohort.name}</span>
                    <span className={`${client.muted} ${client.small}`}>{state.detail}</span>
                  </span>
                </label>
              )
            })}
            {source !== "unallocated" && !picked ? (
              <label className={styles.option}>
                <input type="radio" name="target" checked={target === null} onChange={() => setTarget(null)} />
                <span>
                  <span>Unallocated</span>
                  <span className={`${client.muted} ${client.small}`}>Take them out of {sourceName}</span>
                </span>
              </label>
            ) : null}
            <button type="button" className={`${styles.option} ${styles.optionNew}`} onClick={() => setCreating(true)}>
              + New cohort
            </button>
          </div>
        </fieldset>

        {creating ? (
          <NewCohortForm
            base={base}
            onCancel={() => setCreating(false)}
            onCreated={(id) => {
              setCreating(false)
              setTarget(id)
              setReload((n) => n + 1)
            }}
          />
        ) : null}

        {picked ? null : (
          <fieldset style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 8 }}>
            <legend className={client.secondary} style={{ marginBottom: 8 }}>Who</legend>
            <div className={styles.options} style={{ "--count": 5 } as React.CSSProperties}>
              {WHO.map((option) => {
                const disabled = (option.value === "score" && overview ? !overview.scored : false) || (option.value === "filter" && !fieldKeys.length)
                const detail =
                  option.value === "score" && overview && !overview.scored
                    ? "Scoring is off for this drop"
                    : option.value === "filter" && !fieldKeys.length
                      ? "No drop fields yet"
                      : option.detail(sourceCount)
                return (
                  <label key={option.value} className={styles.option}>
                    <input type="radio" name="mode" checked={mode === option.value} disabled={disabled} onChange={() => setMode(option.value)} />
                    <span>
                      <span>{option.label}</span>
                      <span className={`${client.muted} ${client.small}`}>{detail}</span>
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>
        )}

        {choosing ? (
          <Picker
            base={base}
            source={source}
            field={fieldKeys.includes("size") ? "size" : fieldKeys[0] ?? null}
            chosen={chosen}
            onChange={setChosen}
          />
        ) : null}

        {!picked && mode !== "everyone" && !choosing ? (
          <div className={styles.inline}>
            {mode === "random" || mode === "score" ? (
              <label className={styles.inline}>
                <span className={client.secondary}>How many</span>
                <input className={`${styles.input} ${styles.numberInput}`} type="number" min={1} max={sourceCount || undefined} value={count} onChange={(event) => setCount(event.target.value)} required />
              </label>
            ) : null}
            {fieldKeys.length ? (
              <>
                <span className={client.secondary}>{mode === "filter" ? "Where" : "Only where"}</span>
                <select className={styles.select} value={field} onChange={(event) => { setField(event.target.value); setValues([]) }} aria-label="Field">
                  {fieldKeys.map((key) => (
                    <option key={key} value={key}>{fieldLabel(key)}</option>
                  ))}
                </select>
                <span className={client.secondary}>is</span>
                {(overview?.fields[field] ?? []).map((option) => {
                  const on = values.includes(option)
                  return (
                    <button
                      key={option}
                      type="button"
                      className={`${styles.chip} ${on ? "" : styles.chipOff}`}
                      aria-pressed={on}
                      onClick={() => setValues((current) => (on ? current.filter((v) => v !== option) : [...current, option]))}
                    >
                      {option}
                    </button>
                  )
                })}
              </>
            ) : null}
          </div>
        ) : null}

        {ready ? (
          <div style={{ display: "grid", gap: 10 }}>
            <div className={styles.inline}>
              <span className={styles.matchCount}>
                <strong>{moving === null ? "…" : nf.format(moving)}</strong>{" "}
                <span className={client.secondary}>
                  of {nf.format(sourceCount)} {mode === "random" ? "picked at random when you confirm" : choosing ? "chosen" : "match"}
                </span>
              </span>
            </div>
            {shown?.error ? <p className={client.errorText} role="alert">{shown.error}</p> : null}
            {mode !== "random" && !choosing && shown?.value?.sample.length ? (
              <div className={client.panel}>
                {shown.value.sample.map((entry) => (
                  <div key={entry.id} className={styles.row} style={{ "--columns": "minmax(0,1.6fr) 72px minmax(0,1fr)", minHeight: 44 } as React.CSSProperties}>
                    <span className={client.person}>
                      <span className={client.truncate}>{entry.name ?? entry.email}</span>
                      {entry.name ? <span className={`${client.muted} ${client.small} ${client.truncate}`}>{entry.email}</span> : null}
                    </span>
                    <span className={`${client.mono} ${client.secondary}`}>{field ? entry.fields[field] ?? "–" : ""}</span>
                    <span className={client.secondary}>{entry.cohort?.name ?? ""}</span>
                  </div>
                ))}
                {shown.value.count > shown.value.sample.length ? (
                  <div className={`${styles.row} ${client.muted}`} style={{ "--columns": "1fr", minHeight: 40 } as React.CSSProperties}>
                    {nf.format(shown.value.count - shown.value.sample.length)} more
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <label className={styles.label}>
          <span>
            Note for the history <span className={client.muted}>· optional</span>
          </span>
          <input className={styles.input} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1200} placeholder="For example: entered a size that's sold out" />
        </label>

        {ready && moving !== null ? (
          <div className={styles.note}>
            <strong>
              {nf.format(moving)} {moving === 1 ? "person moves" : "people move"} from {picked ? "where they are now" : sourceName} to {targetLabel}
            </strong>
            <span>
              {target === null
                ? "They keep their approval but lose any access a cohort gave them."
                : targetCohort?.grantsAccess
                  ? `${targetLabel} grants access: each person gets an access secret.`
                  : `${targetLabel} doesn't grant access.`}{" "}
              Your system gets <span className={client.mono}>application.allocated</span> for each person, and the rule is saved in the history.
            </span>
            {overCapacity ? <span style={{ color: "var(--danger)" }}>Only {nf.format(room ?? 0)} places are left in {targetLabel}.</span> : null}
          </div>
        ) : null}

        {error ? <p className={client.errorText} role="alert">{error}</p> : null}

        <div className={dashboard.dialogActions}>
          <button type="button" className={client.button} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={client.buttonPrimary} disabled={busy || !ready || !moving || overCapacity}>
            {busy ? "Moving…" : target === null ? `Take out ${moving ? nf.format(moving) : ""}` : `Add ${moving ? nf.format(moving) : ""} to ${targetLabel}`}
          </button>
        </div>
      </form>
    </dialog>
  )
}

/** Inline form for a new cohort; also used by the Cohorts page dialog. */
export function NewCohortForm({ base, onCancel, onCreated }: { base: string; onCancel: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("")
  const [grantsAccess, setGrantsAccess] = useState(false)
  const [capacity, setCapacity] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`${base}/cohorts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, grantsAccess, capacity: capacity ? Number(capacity) : null }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The cohort could not be created.")
      onCreated(body.id as string)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The cohort could not be created.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={client.panel} style={{ padding: 16, display: "grid", gap: 14 }}>
      <label className={styles.label}>
        Name
        <input className={styles.input} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Ballot pool" autoFocus />
      </label>
      <div className={styles.inline} style={{ gap: 24 }}>
        <label className={styles.checkLabel}>
          <input type="checkbox" className={styles.check} checked={grantsAccess} onChange={(event) => setGrantsAccess(event.target.checked)} />
          <span>
            <span>Grants access</span>
            <span className={`${client.muted} ${client.small}`}>Members get an access secret</span>
          </span>
        </label>
        <label className={styles.inline}>
          <span className={client.secondary}>Places</span>
          <input className={`${styles.input} ${styles.numberInput}`} type="number" min={1} value={capacity} onChange={(event) => setCapacity(event.target.value)} placeholder="No limit" aria-label="Places" />
        </label>
      </div>
      {error ? <p className={client.errorText} role="alert">{error}</p> : null}
      <div className={styles.inline} style={{ justifyContent: "flex-end" }}>
        <button type="button" className={client.button} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={client.buttonPrimary} disabled={busy || !name.trim()} onClick={() => void create()}>
          {busy ? "Creating…" : "Create cohort"}
        </button>
      </div>
    </div>
  )
}

type PickerPage = { entries: EntryItem[]; total: number }
const PICK_PAGE = 50

/** Everyone in the source, with a tick box each. Ticks survive search and paging. */
function Picker({
  base,
  source,
  field,
  chosen,
  onChange,
}: {
  base: string
  source: string
  field: string | null
  chosen: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const [search, setSearch] = useState("")
  const [query, setQuery] = useState("")
  const [offset, setOffset] = useState(0)
  const [state, setState] = useState<{ key: string; page?: PickerPage; error?: string } | null>(null)
  const key = `${source}|${query}|${offset}`

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim())
      setOffset(0)
    }, 250)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    let cancelled = false
    fetch(`${base}/cohorts/fill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, target: null, mode: "everyone", list: { offset, search: query } }),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "People could not be loaded.")
        if (!cancelled) setState({ key, page: body as PickerPage })
      })
      .catch((problem: Error) => {
        if (!cancelled) setState({ key, error: problem.message })
      })
    return () => {
      cancelled = true
    }
  }, [base, source, query, offset, key])

  const page = state?.page
  const entries = page?.entries ?? []
  const allOnPage = entries.length > 0 && entries.every((entry) => chosen.has(entry.id))
  const columns = { "--columns": `28px minmax(0,1.6fr)${field ? " 72px" : ""} minmax(0,1fr)`, minHeight: 44 } as React.CSSProperties

  function toggle(id: string) {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className={styles.inline}>
        <input
          className={client.search}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name or email"
          aria-label="Search people to choose"
          style={{ flex: 1 }}
        />
        {chosen.size ? (
          <button type="button" className={styles.linkButton} onClick={() => onChange(new Set())}>
            Clear {nf.format(chosen.size)} chosen
          </button>
        ) : null}
      </div>
      {state?.error ? <p className={client.errorText} role="alert">{state.error}</p> : null}
      <div className={client.panel} style={{ maxHeight: 320, overflowY: "auto" }} aria-busy={state?.key !== key}>
        <div className={`${styles.row} ${styles.rowHead}`} style={columns}>
          <input
            type="checkbox"
            className={styles.check}
            aria-label="Choose everyone on this page"
            checked={allOnPage}
            onChange={() => {
              const next = new Set(chosen)
              for (const entry of entries) {
                if (allOnPage) next.delete(entry.id)
                else next.add(entry.id)
              }
              onChange(next)
            }}
            disabled={!entries.length}
          />
          <span>Person</span>
          {field ? <span>{fieldLabel(field)}</span> : null}
          <span>Entered</span>
        </div>
        {entries.map((entry) => {
          const name = entry.name ?? entry.email ?? "Entrant"
          return (
            <label key={entry.id} className={`${styles.row} ${chosen.has(entry.id) ? styles.rowSelected : ""}`} style={{ ...columns, cursor: "pointer" }}>
              <input type="checkbox" className={styles.check} checked={chosen.has(entry.id)} onChange={() => toggle(entry.id)} aria-label={`Choose ${name}`} />
              <span className={client.person}>
                <span className={client.truncate}>{name}</span>
                {entry.name && entry.email ? <span className={`${client.muted} ${client.small} ${client.truncate}`}>{entry.email}</span> : null}
              </span>
              {field ? <span className={`${client.mono} ${client.secondary}`}>{entry.fields[field] ?? "–"}</span> : null}
              <span className={`${client.muted} ${client.small}`}>{shortDate(entry.createdAt)}</span>
            </label>
          )
        })}
        {page && !entries.length ? (
          <p className={client.muted} style={{ margin: 0, padding: "14px 16px" }}>{query ? "Nobody matches." : "Nobody here to choose."}</p>
        ) : null}
      </div>
      {page && page.total > PICK_PAGE ? (
        <div className={styles.footer}>
          <span className={client.muted}>
            {nf.format(offset + 1)}–{nf.format(Math.min(offset + PICK_PAGE, page.total))} of {nf.format(page.total)}
          </span>
          <span>
            <button type="button" className={client.button} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PICK_PAGE))}>
              Previous
            </button>
            <button type="button" className={client.button} disabled={offset + PICK_PAGE >= page.total} onClick={() => setOffset(offset + PICK_PAGE)}>
              Next
            </button>
          </span>
        </div>
      ) : null}
    </div>
  )
}
