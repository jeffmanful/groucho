"use client"

import Link from "next/link"
import { useState, type CSSProperties } from "react"
import type { ProjectSummary } from "@/lib/organisation-summary"
import { projectStatus } from "./OrgOverview"
import { useOrganisationSummary } from "./OrganisationSummaryContext"
import styles from "./dashboard.module.css"

const COLUMNS = {
  "--columns": "minmax(160px, 2fr) 104px minmax(140px, 1.6fr) 72px 72px 80px 350px",
} as CSSProperties

export function OrgProjects() {
  const { orgId, summary, error, refresh } = useOrganisationSummary()
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const base = `/admin/organisations/${orgId}`

  async function setArchived(project: ProjectSummary, archived: boolean) {
    setBusy(project.id)
    setActionError(null)
    try {
      const response = await fetch(`/api/admin/organisations/${orgId}/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { archived } }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The project could not be updated.")
      refresh()
    } catch (problem) {
      setActionError(problem instanceof Error ? problem.message : "The project could not be updated.")
    } finally {
      setBusy(null)
    }
  }

  if (!summary) {
    return (
      <div className={styles.page}>
        {error ? <p className={styles.error} role="alert">{error}</p> : <div className={styles.skeleton} />}
      </div>
    )
  }

  const active = summary.projects.filter((project) => !project.archived)
  const archived = summary.projects.filter((project) => project.archived)

  const row = (project: ProjectSummary) => {
    const status = projectStatus(project)
    const gatekeeper = project.projectType === "gatekeeper"
    return (
      <div key={project.id} className={styles.row} style={COLUMNS}>
        <Link className={styles.name} href={`${base}/projects/${project.id}`}>{project.name}</Link>
        <span className={styles.status}>
          <span className={status.dot} aria-hidden="true" />
          {status.label}
        </span>
        <span className={styles.secondaryText}>{project.personaName ?? "Workspace default"}</span>
        <span className={`${styles.num} ${project.conversations30d ? "" : styles.dim}`}>{project.conversations30d}</span>
        <span className={styles.num}>{project.conversationsTotal}</span>
        <span className={`${styles.num} ${project.toReview ? styles.attention : styles.dim}`}>{project.toReview ?? "–"}</span>
        <span className={styles.rowActions}>
          {gatekeeper ? <Link className={styles.rowAction} href={`${base}/applications?project=${project.id}`}>Applications</Link> : null}
          {project.projectType !== "ticket_access" ? (
            <Link className={styles.rowAction} href={`/admin/sessions?project=${project.id}`}>Conversations</Link>
          ) : null}
          {summary.canManage ? <Link className={styles.rowAction} href={`${base}/projects/${project.id}/edit`}>Setup</Link> : null}
          {project.projectType !== "ticket_access" ? <Link className={styles.rowAction} href={`${base}/projects/${project.id}`}>Keys</Link> : null}
          {summary.canManage ? (
            <button type="button" className={styles.rowAction} disabled={busy === project.id} onClick={() => void setArchived(project, !project.archived)}>
              {busy === project.id ? "Saving…" : project.archived ? "Restore" : "Archive"}
            </button>
          ) : null}
        </span>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Projects</h1>
          <p className={styles.subtitle}>Archiving hides a project from active lists. It keeps its conversations and settings.</p>
        </div>
        {summary.canManage ? (
          <div className={styles.actions}>
            <Link className={styles.primary} href={`${base}/projects/new`}>New project</Link>
          </div>
        ) : null}
      </header>

      {actionError ? <p className={styles.error} role="alert">{actionError}</p> : null}

      <div className={styles.table}>
        <div className={styles.tableInner} style={{ minWidth: 1090 }}>
          <div className={styles.head} style={COLUMNS}>
            <span>Name</span>
            <span>Status</span>
            <span>Persona</span>
            <span className={styles.num}>30 days</span>
            <span className={styles.num}>All time</span>
            <span className={styles.num}>To review</span>
            <span />
          </div>
          <h2 className={styles.groupRow}>Active <span className={styles.dim}>{active.length}</span></h2>
          {active.length ? active.map(row) : <p className={styles.row} style={{ color: "var(--text-muted)" }}>No active projects.</p>}
          {archived.length ? (
            <>
              <h2 className={styles.groupRow}>Archived <span className={styles.dim}>{archived.length}</span></h2>
              {archived.map(row)}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
