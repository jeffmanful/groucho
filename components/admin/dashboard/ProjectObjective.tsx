"use client"

import Link from "next/link"
import { useEffect, useId, useRef, useState, type FormEvent } from "react"
import { Button } from "@/components/arc/button/button"
import { MAX_OBJECTIVE_LENGTH } from "@/lib/project-review-objective"
import { shortDate } from "@/lib/relative-time"
import { useProjectOverview } from "./ProjectOverviewContext"
import { useOrganisationProject } from "./OrganisationProjectContext"
import { useOrganisationSummary } from "./OrganisationSummaryContext"
import styles from "./project-overview.module.css"

export function ProjectObjective({ reviewing = false }: { reviewing?: boolean }) {
  const { data, error: loadError, refresh, saveObjective } = useProjectOverview()
  const { orgId } = useOrganisationSummary()
  const { href } = useOrganisationProject()
  const id = useId()
  const root = useRef<HTMLElement>(null)
  const editButton = useRef<HTMLButtonElement>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [cohortId, setCohortId] = useState("")
  const [revision, setRevision] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const objective = data?.objective
  const target = data?.cohorts.find((cohort) => cohort.id === objective?.cohortId)

  useEffect(() => {
    if (!reviewing || !root.current) return
    const node = root.current
    const workspace = node.closest<HTMLElement>("[data-review-workspace]")
    if (!workspace) return
    const measure = () => workspace.style.setProperty("--review-context-height", `${node.getBoundingClientRect().height}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => { observer.disconnect(); workspace.style.removeProperty("--review-context-height") }
  }, [reviewing])

  function edit() {
    setDraft(objective?.text ?? "")
    setCohortId(objective?.cohortId ?? "")
    setRevision(objective?.revision ?? null)
    setError(null)
    setNotice(null)
    setEditing(true)
  }

  function finish() {
    setEditing(false)
    requestAnimationFrame(() => editButton.current?.focus())
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const result = await saveObjective({ text: draft, cohortId: cohortId || null, revision })
      setNotice(result.warning ?? "Objective saved.")
      finish()
    } catch (problem) { setError(problem instanceof Error ? problem.message : "The objective could not be saved.") }
    finally { setSaving(false) }
  }

  return (
    <section ref={root} className={`${styles.card} ${reviewing ? styles.reviewContext : styles.objectiveCard}`} aria-labelledby={`${id}-title`} tabIndex={reviewing ? 0 : undefined}>
      <div className={styles.cardHeader}>
        <h2 id={`${id}-title`} className={styles.sectionTitle}>{reviewing ? "Current objective" : "What are we working towards?"}</h2>
        {reviewing ? <Link className={styles.textLink} href={href(`/admin/organisations/${orgId}`)}>Project overview</Link>
          : data?.canEditObjective && !editing ? <Button ref={editButton} className={styles.editAction} variant="ghost" size="sm" onClick={edit}>{objective?.text ? "Edit objective" : "Set objective"}</Button> : null}
      </div>
      {editing ? (
        <form className={styles.objectiveForm} onSubmit={(event) => void save(event)}>
          <label className={styles.field} htmlFor={`${id}-text`}>
            Current objective
            <textarea id={`${id}-text`} value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={MAX_OBJECTIVE_LENGTH} rows={4} autoFocus disabled={saving} placeholder="What are we working towards, and who are we looking for?" />
          </label>
          <label className={styles.field} htmlFor={`${id}-cohort`}>
            Focus cohort (optional)
            <select id={`${id}-cohort`} value={cohortId} onChange={(event) => setCohortId(event.target.value)} disabled={saving}>
              <option value="">Whole project</option>
              {cohortId && !data?.cohorts.some((cohort) => cohort.id === cohortId) ? <option value={cohortId} disabled>Previously linked cohort is unavailable</option> : null}
              {data?.cohorts.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}</option>)}
            </select>
          </label>
          <p className={styles.meta}>Shared with everyone reviewing this project.</p>
          {revision !== (objective?.revision ?? null) ? <div className={styles.conflict} role="status">
            <p>The objective changed while you were editing. Your draft has been kept.</p>
            <p className={styles.meta}>Latest saved objective</p>
            <p className={styles.objectiveText}>{objective?.text || "No objective set."}</p>
            <div className={styles.actions}>
              <Button type="button" variant="secondary" size="sm" onClick={() => { setDraft(objective?.text ?? ""); setCohortId(objective?.cohortId ?? ""); setRevision(objective?.revision ?? null); setError(null) }}>Use saved version</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => { setRevision(objective?.revision ?? null); setError(null) }}>Keep my draft</Button>
            </div>
          </div> : null}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          <div className={styles.actions}>
            <Button type="submit" size="sm" loading={saving} disabled={revision !== (objective?.revision ?? null)}>Save objective</Button>
            <Button type="button" size="sm" variant="secondary" onClick={finish} disabled={saving}>Cancel</Button>
          </div>
        </form>
      ) : (
        <>
          {objective?.text ? <p className={styles.objectiveText}>{objective.text}</p> : <p className={styles.secondary}>{data ? "No objective set yet. Add a shared focus for this round of application reviews." : loadError ? "The current objective could not be loaded." : "Loading the current objective…"}</p>}
          {data ? <div className={styles.objectiveFooter}>
            <span className={styles.meta}>{target ? `For ${target.name}` : data.round ? `Current round: ${data.round.name}` : "Shared project review guidance"}</span>
            {!reviewing && objective ? <span className={styles.meta}>Updated {objective.updatedBy ? `by ${objective.updatedBy} · ` : ""}{shortDate(objective.updatedAt)}</span> : null}
          </div> : null}
          {reviewing && target ? <p className={styles.meta}>{target.members.toLocaleString()} {target.capacity !== null ? `/ ${target.capacity.toLocaleString()} ` : ""}people added to this cohort{target.capacity !== null ? ` · ${Math.max(0, target.capacity - target.members).toLocaleString()} places remaining` : ""}</p> : null}
          {loadError ? <p className={styles.error} role="alert">{loadError} <button className={styles.inlineAction} onClick={refresh}>Try again</button></p> : null}
          {notice ? <p className={styles.meta} role="status">{notice}</p> : null}
        </>
      )}
    </section>
  )
}
