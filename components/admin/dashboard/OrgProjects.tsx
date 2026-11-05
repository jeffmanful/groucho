"use client"

import Link from "next/link"
import { useState } from "react"
import { Button } from "@/components/arc/button/button"
import { withProject } from "@/lib/admin-project-selection"
import type { ProjectSummary } from "@/lib/organisation-summary"
import { projectStatus } from "./OrgOverview"
import { useOrganisationSummary } from "./OrganisationSummaryContext"
import styles from "./dashboard.module.css"
import layout from "./org-projects.module.css"

export function OrgProjects() {
  const { orgId, summary, loading, error, refresh } = useOrganisationSummary()
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

  const baseProjects = `${base}/projects`
  const active = summary?.projects.filter((project) => !project.archived) ?? []
  const archived = summary?.projects.filter((project) => project.archived) ?? []

  function renderProject(project: ProjectSummary) {
    const status = projectStatus(project)
    const href = `${baseProjects}/${project.id}`
    const projectHome = project.archived || project.projectType === "ticket_access" ? href : withProject(base, project.id)

    return (
      <li key={project.id} className={layout.project}>
        <div className={layout.identity}>
          <h3><Link className={layout.projectName} href={projectHome}>{project.name}</Link></h3>
          <div className={layout.details}>
            <span className={styles.status}>
              <span className={status.dot} aria-hidden="true" />
              {status.label}
            </span>
            <span>{project.personaName ?? "Workspace default"}</span>
          </div>
        </div>
        <dl className={layout.metrics}>
          <div>
            <dt>Conversations, 30d</dt>
            <dd>{project.conversations30d}</dd>
          </div>
          <div>
            <dt>All time</dt>
            <dd>{project.conversationsTotal}</dd>
          </div>
          <div>
            <dt>To review</dt>
            <dd className={project.toReview ? styles.attention : styles.dim}>
              {project.toReview ?? <span aria-label="Unavailable">–</span>}
            </dd>
          </div>
        </dl>
        <div className={layout.projectActions}>
          {project.projectType === "gatekeeper" ? (
            <Link className={styles.rowAction} href={`${base}/applications?project=${project.id}`}>Applications</Link>
          ) : null}
          {summary?.canManage ? <Link className={styles.rowAction} href={`${href}/edit`}>Setup</Link> : null}
          {project.projectType !== "ticket_access" ? (
            <Link className={styles.rowAction} href={href}>Integrations</Link>
          ) : null}
          {summary?.canManage ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={layout.archive}
              loading={busy === project.id}
              disabled={(busy !== null && busy !== project.id) || (loading && busy === null)}
              onClick={() => void setArchived(project, !project.archived)}
            >
              {project.archived ? "Restore" : "Archive"}
            </Button>
          ) : null}
        </div>
      </li>
    )
  }

  return (
    <div className={`${styles.page} ${layout.workspace}`}>
      <header className={styles.header}>
        <h1 className={styles.title}>Projects</h1>
        {summary?.canManage ? (
          <Link className={styles.primary} href={`${baseProjects}/new`}>New project</Link>
        ) : null}
      </header>

      {actionError ? <p className={styles.error} role="alert">{actionError}</p> : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error} <Button type="button" size="sm" variant="ghost" loading={loading} onClick={refresh}>Try again</Button>
        </p>
      ) : null}

      {summary ? (
        <>
          <section className={styles.section} aria-labelledby="active-projects">
            <h2 id="active-projects" className={layout.sectionTitle}>
              Active projects <span className={styles.count}>{active.length}</span>
            </h2>
            {active.length ? (
              <ul className={layout.projects}>{active.map(renderProject)}</ul>
            ) : (
              <p className={styles.empty}>No active projects.</p>
            )}
          </section>

          {archived.length ? (
            <section className={styles.section} aria-labelledby="archived-projects">
              <h2 id="archived-projects" className={layout.sectionTitle}>
                Archived projects <span className={styles.count}>{archived.length}</span>
              </h2>
              <ul className={layout.projects}>{archived.map(renderProject)}</ul>
            </section>
          ) : null}

          {summary.canManage && summary.projects.length ? (
            <p className={layout.hint}>Archiving hides a project from active lists and keeps its conversations and settings.</p>
          ) : null}
        </>
      ) : !error ? (
        <p className={layout.hint} role="status">Loading projects…</p>
      ) : null}
    </div>
  )
}
