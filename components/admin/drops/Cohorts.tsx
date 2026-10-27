"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import dashboard from "@/components/admin/dashboard/dashboard.module.css"
import client from "@/components/admin/client/client.module.css"
import type { AllocationRun, Cohort, CohortsOverview } from "@/lib/cohorts"
import type { EntryItem } from "@/lib/entry-review"
import { shortDate } from "@/lib/relative-time"
import { AddToCohortDialog, NewCohortForm } from "./AddToCohortDialog"
import { DrawDialog } from "./DrawDialog"
import styles from "./drops.module.css"
import { fieldLabel, nf, ProjectSwitch, useDropProject } from "./useDropProject"

const COLUMNS = { "--columns": "minmax(0,1.6fr) 130px minmax(0,1.1fr) minmax(0,1fr) minmax(250px,auto)" } as CSSProperties

function status(cohort: Cohort): { text: string; dot: string } {
  if (cohort.drawnAt) return { text: `Drawn ${shortDate(cohort.drawnAt)}`, dot: client.dotSuccess }
  if (cohort.lockedAt) return { text: `Locked ${shortDate(cohort.lockedAt)}`, dot: "" }
  if (cohort.capacity !== null && cohort.members >= cohort.capacity) return { text: "Full", dot: client.dotSuccess }
  if (!cohort.members) return { text: "Empty", dot: "" }
  return { text: "Open", dot: client.dotSelection }
}

function who(run: AllocationRun): string {
  return run.actor.includes("@") ? run.actor.split("@")[0] : run.actor
}

function describeRule(rule: Record<string, unknown>): string | null {
  const filter = rule.filter as { field?: string; values?: string[] } | undefined
  const parts: string[] = []
  if (filter?.field && filter.values?.length) parts.push(`${fieldLabel(filter.field).toLowerCase()} is ${filter.values.join(" or ")}`)
  if (rule.mode === "random") parts.push("at random")
  if (rule.mode === "score") parts.push("top by score")
  if (rule.mode === "select") parts.push("chosen by hand")
  if (rule.mode === "everyone") parts.push("everyone")
  return parts.length ? parts.join(", ") : null
}

function History({ runs }: { runs: AllocationRun[] }) {
  return (
    <div className={`${client.panel} ${styles.history}`}>
      {runs.map((run) => {
        const people = `${nf.format(run.moved)} ${run.moved === 1 ? "person" : "people"}`
        let line: React.ReactNode
        if (run.kind === "lock") line = <>{who(run)} locked <strong>{run.targetCohort}</strong> with {nf.format(Number(run.rule.members ?? 0))} people</>
        else if (run.kind === "unlock") line = <>{who(run)} unlocked <strong>{run.targetCohort}</strong></>
        else if (run.kind === "draw") line = <>{who(run)} drew {nf.format(run.moved)} from <strong>{run.sourceCohort}</strong> into <strong>{run.targetCohort}</strong></>
        else if (run.kind === "remove") line = <>{who(run)} took {people} out of <strong>{run.sourceCohort ?? "a cohort"}</strong></>
        else {
          const rule = run.kind === "api" ? "from your app" : describeRule(run.rule)
          line = (
            <>
              {who(run)} placed {people} in <strong>{run.targetCohort}</strong>
              {run.sourceCohort ? <> from {run.sourceCohort}</> : null}
              {rule ? <span className={client.muted}> · {rule}</span> : null}
            </>
          )
        }
        return (
          <span key={run.id}>
            <time className={`${client.mono} ${client.muted}`} dateTime={run.createdAt}>{shortDate(run.createdAt)}</time>
            <span>
              {line}
              {run.reason ? <span className={client.muted}>: {run.reason}</span> : null}
            </span>
          </span>
        )
      })}
    </div>
  )
}

export function Cohorts() {
  const { orgId, projects, project, choose, canManage, summary } = useDropProject()
  const projectId = project?.id ?? null
  const base = orgId && projectId ? `/api/admin/organisations/${orgId}/projects/${projectId}` : ""
  const [reload, setReload] = useState(0)
  const [state, setState] = useState<{ key: string; data?: CohortsOverview; error?: string } | null>(null)
  const [adding, setAdding] = useState<{ source: string; target?: string | null } | null>(null)
  const [drawing, setDrawing] = useState<Cohort | null>(null)
  const [opening, setOpening] = useState<Cohort | null>(null)
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const key = `${base}|${reload}`
  const refresh = useCallback(() => setReload((n) => n + 1), [])

  useEffect(() => {
    if (!base) return
    let cancelled = false
    fetch(`${base}/cohorts`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Cohorts could not be loaded.")
        if (!cancelled) setState({ key, data: body as CohortsOverview })
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ key, error: error.message })
      })
    return () => {
      cancelled = true
    }
  }, [base, key])

  const data = state?.data
  const done = (message: string) => {
    setAdding(null)
    setDrawing(null)
    setCreating(false)
    setNotice(message)
    refresh()
  }

  async function setLocked(cohort: Cohort, locked: boolean) {
    setActionError(null)
    const response = await fetch(`${base}/cohorts/${cohort.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locked }) })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      setActionError(typeof body.error === "string" ? body.error : "That didn't work.")
      return
    }
    setNotice(locked ? `${cohort.name} is locked. Nobody can be added or removed until you unlock it.` : `${cohort.name} is unlocked.`)
    refresh()
  }

  if (summary && !project) {
    return (
      <div className={dashboard.page}>
        <h1 className={dashboard.title}>Cohorts</h1>
        <p className={client.muted}>Create a project to start taking entries.</p>
      </div>
    )
  }

  return (
    <div className={dashboard.page} style={{ maxWidth: 1240 }}>
      <header className={styles.head}>
        <h1 className={dashboard.title}>Cohorts</h1>
        <span className={client.muted}>/</span>
        <ProjectSwitch projects={projects} value={projectId ?? ""} onChange={choose} />
        <span className={styles.headActions}>
          <Link className={client.button} href={`/admin/organisations/${orgId}/entries${projectId ? `?project=${projectId}` : ""}`}>
            Entries
          </Link>
          {canManage ? (
            <button type="button" className={client.button} onClick={() => setCreating(true)}>
              New cohort
            </button>
          ) : null}
        </span>
      </header>

      {state?.error ? <p className={dashboard.error} role="alert">{state.error}</p> : null}
      {actionError ? <p className={dashboard.error} role="alert">{actionError}</p> : null}
      {notice ? <p className={client.secondary} role="status" style={{ margin: 0 }}>{notice}</p> : null}

      {data && data.unallocated > 0 ? (
        <div className={`${client.panel} ${styles.callout}`}>
          <span className={`${client.dot} ${client.dotWarning}`} aria-hidden="true" />
          <span>
            {nf.format(data.unallocated)} approved {data.unallocated === 1 ? "person isn’t" : "people aren’t"} in a cohort yet.
            {data.cohorts.some((c) => c.lockedAt) ? <span className={client.secondary}> Anyone approved after a cohort was locked lands here.</span> : null}
          </span>
          {canManage ? (
            <button type="button" className={client.button} onClick={() => setAdding({ source: "unallocated" })} disabled={!data.cohorts.length}>
              Add to a cohort
            </button>
          ) : null}
        </div>
      ) : data && data.cohorts.length && !data.cohorts.some((c) => c.members) ? (
        <div className={`${client.panel} ${styles.callout}`}>
          <span className={client.dot} aria-hidden="true" />
          <span>
            Nobody here is approved yet. <span className={client.secondary}>Cohorts only hold approved people, so approve entries first and they’ll show up here, ready to place.</span>
          </span>
          <Link className={client.button} href={`/admin/organisations/${orgId}/entries?project=${projectId}`}>
            Review entries
          </Link>
        </div>
      ) : null}

      {data && !data.cohorts.length ? (
        <div className={client.panel} style={{ padding: "28px 24px", display: "grid", gap: 10, justifyItems: "start" }}>
          <h2 className={styles.sectionTitle} style={{ margin: 0 }}>No cohorts yet</h2>
          <p className={client.secondary} style={{ margin: 0, maxWidth: 560 }}>
            Cohorts are groups of approved people: a ballot pool, guaranteed places for true fans, the winners of a draw.
            Only cohorts that grant access let people use their access secret.
          </p>
          {canManage ? (
            <button type="button" className={client.buttonPrimary} onClick={() => setCreating(true)}>
              New cohort
            </button>
          ) : null}
        </div>
      ) : null}

      {data?.cohorts.length ? (
        <div className={`${client.panel} ${styles.table}`} aria-busy={state?.key !== key}>
          <div className={styles.tableInner}>
            <div className={`${styles.row} ${styles.rowHead}`} style={COLUMNS}>
              <span>Cohort</span>
              <span>Access</span>
              <span>People</span>
              <span>Status</span>
              <span />
            </div>
            {data.cohorts.map((cohort) => {
              const s = status(cohort)
              const share = cohort.capacity ? Math.min(100, Math.round((cohort.members / cohort.capacity) * 100)) : null
              return (
                <div key={cohort.id} className={styles.row} style={{ ...COLUMNS, minHeight: 64 }}>
                  <button type="button" className={styles.linkButton} style={{ textDecoration: "none", color: "var(--foreground)", textAlign: "left" }} onClick={() => setOpening(cohort)}>
                    {cohort.name}
                  </button>
                  {cohort.grantsAccess ? (
                    <span className={client.badge}>
                      <span className={`${client.dot} ${client.dotSuccess}`} aria-hidden="true" />
                      Grants access
                    </span>
                  ) : (
                    <span className={client.muted}>No access</span>
                  )}
                  <span className={styles.people}>
                    <span className={client.mono}>
                      {nf.format(cohort.members)}
                      {cohort.capacity !== null ? ` / ${nf.format(cohort.capacity)}` : ""}
                    </span>
                    {share !== null ? (
                      <span className={styles.bar} aria-hidden="true">
                        <span style={{ width: `${share}%` }} />
                      </span>
                    ) : null}
                  </span>
                  <span className={`${client.status} ${client.secondary}`}>
                    <span className={`${client.dot} ${s.dot}`} aria-hidden="true" />
                    {s.text}
                  </span>
                  <span className={styles.actions}>
                    {cohort.members ? (
                      <a className={client.buttonGhost} href={`${base}/cohorts/${cohort.id}/export`}>
                        Export
                      </a>
                    ) : null}
                    {canManage && !cohort.drawnAt ? (
                      cohort.lockedAt ? (
                        <button type="button" className={client.buttonGhost} onClick={() => void setLocked(cohort, false)}>
                          Unlock
                        </button>
                      ) : cohort.members ? (
                        <button type="button" className={client.buttonGhost} onClick={() => void setLocked(cohort, true)}>
                          Lock
                        </button>
                      ) : null
                    ) : null}
                    {canManage && cohort.lockedAt && !cohort.drawnAt && cohort.members ? (
                      <button type="button" className={client.button} onClick={() => setDrawing(cohort)}>
                        Draw winners
                      </button>
                    ) : canManage && !cohort.lockedAt && !cohort.drawnAt && (cohort.capacity === null || cohort.members < cohort.capacity) ? (
                      <button type="button" className={client.button} onClick={() => setAdding({ source: "unallocated", target: cohort.id })} disabled={!data.unallocated} title={data.unallocated ? undefined : "Everyone approved is already in a cohort"}>
                        Add people
                      </button>
                    ) : (
                      <button type="button" className={client.button} onClick={() => setOpening(cohort)}>
                        Open
                      </button>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {data?.history.length ? (
        <section>
          <h2 className={styles.sectionTitle}>History</h2>
          <History runs={data.history} />
        </section>
      ) : null}

      {creating && base ? <NewCohortDialog base={base} onClose={() => setCreating(false)} onCreated={() => done("Cohort created.")} /> : null}
      {adding && orgId && projectId ? (
        <AddToCohortDialog orgId={orgId} projectId={projectId} source={adding.source} initialTarget={adding.target} onClose={() => setAdding(null)} onDone={done} />
      ) : null}
      {drawing && data ? (
        <DrawDialog base={base} source={drawing} cohorts={data.cohorts} fields={Object.keys(data.fields)} onClose={() => setDrawing(null)} onDone={done} />
      ) : null}
      {opening && data ? (
        <CohortDrawer
          base={base}
          cohort={data.cohorts.find((c) => c.id === opening.id) ?? opening}
          canManage={canManage}
          onClose={() => setOpening(null)}
          onMove={() => {
            setOpening(null)
            setAdding({ source: opening.id })
          }}
        />
      ) : null}
    </div>
  )
}

function NewCohortDialog({ base, onClose, onCreated }: { base: string; onClose: () => void; onCreated: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog ref={ref} className={`${dashboard.dialog} ${styles.dialogMedium}`} onClose={onClose} aria-labelledby="new-cohort-title">
      <div className={dashboard.dialogBody}>
        <div className={dashboard.dialogHeader}>
          <div>
            <h2 id="new-cohort-title">New cohort</h2>
            <p>A group of approved people, such as a ballot pool, guaranteed places or the winners of a draw.</p>
          </div>
        </div>
        <NewCohortForm base={base} onCancel={onClose} onCreated={onCreated} />
      </div>
    </dialog>
  )
}

function CohortDrawer({ base, cohort, canManage, onClose, onMove }: { base: string; cohort: Cohort; canManage: boolean; onClose: () => void; onMove: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [offset, setOffset] = useState(0)
  const [state, setState] = useState<{ offset: number; entries?: Array<EntryItem & { position: number | null }>; total?: number; error?: string } | null>(null)
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
  }, [base, cohort.id, offset])
  const total = state?.total ?? cohort.members
  const fieldKeys = [...new Set((state?.entries ?? []).flatMap((entry) => Object.keys(entry.fields)))].slice(0, 2)
  const columns = { "--columns": `48px minmax(0,1.6fr) ${fieldKeys.map(() => "72px").join(" ")} minmax(0,1fr)`, minHeight: 48 } as CSSProperties

  return (
    <dialog ref={ref} className={`${dashboard.dialog} ${styles.drawer}`} onClose={onClose} aria-labelledby="drawer-title">
      <div className={dashboard.dialogBody}>
        <div className={dashboard.dialogHeader}>
          <div>
            <h2 id="drawer-title">{cohort.name}</h2>
            <p>
              {nf.format(cohort.members)} {cohort.members === 1 ? "person" : "people"}
              {cohort.capacity !== null ? ` of ${nf.format(cohort.capacity)} places` : ""} · {cohort.grantsAccess ? "Grants access" : "No access"}
              {cohort.lockedAt ? ` · Locked ${shortDate(cohort.lockedAt)}` : ""}
            </p>
          </div>
          <button type="button" className={client.buttonGhost} onClick={onClose} aria-label="Close">
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
            <button type="button" className={client.button} onClick={onMove}>
              Move people…
            </button>
          ) : null}
        </div>
        {state?.error ? <p className={client.errorText} role="alert">{state.error}</p> : null}
        <div className={client.panel} aria-busy={state?.offset !== offset}>
          {(state?.entries ?? []).map((entry, index) => (
            <div key={entry.id} className={styles.row} style={columns}>
              <span className={`${client.mono} ${client.muted}`}>{entry.position ?? offset + index + 1}</span>
              <span className={client.person}>
                <span className={client.truncate}>{entry.name ?? entry.email}</span>
                {entry.name ? <span className={`${client.muted} ${client.small} ${client.truncate}`}>{entry.email}</span> : null}
              </span>
              {fieldKeys.map((key) => (
                <span key={key} className={`${client.mono} ${client.secondary}`}>{entry.fields[key] ?? "–"}</span>
              ))}
              <span className={`${client.muted} ${client.small}`}>{shortDate(entry.createdAt)}</span>
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
              <button type="button" className={client.button} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>
                Previous
              </button>
              <button type="button" className={client.button} disabled={offset + 100 >= total} onClick={() => setOffset(offset + 100)}>
                Next
              </button>
            </span>
          </div>
        ) : null}
      </div>
    </dialog>
  )
}
