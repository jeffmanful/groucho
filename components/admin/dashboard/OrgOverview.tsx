"use client"

import Link from "next/link"
import type { CSSProperties } from "react"
import type { ProjectSummary } from "@/lib/organisation-summary"
import { useOrganisationSummary } from "./OrganisationSummaryContext"
import styles from "./dashboard.module.css"

const COLUMNS = { "--columns": "minmax(0, 2fr) minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 0.8fr) minmax(0, 1fr)" } as CSSProperties

export function projectStatus(project: ProjectSummary): { dot: string; label: string } {
  if (project.archived) return { dot: styles.dotEnded, label: "Archived" }
  if (project.projectType === "ticket_access") return { dot: styles.dotIdle, label: "Simulation" }
  if (project.environment === "live") return { dot: styles.dotLive, label: "Live" }
  return { dot: styles.dotIdle, label: "Testing" }
}

export function hoursLabel(hours: number | null): string {
  if (hours === null) return "–"
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`
  if (hours < 48) return `${Math.round(hours)} h`
  return `${Math.round(hours / 24)} days`
}

function relative(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function OrgOverview() {
  const { orgId, summary, loading, error, refresh } = useOrganisationSummary()
  if (!summary) {
    return (
      <div className={styles.page}>
        {error ? (
          <p className={styles.error} role="alert">
            {error} <button type="button" className={styles.rowAction} onClick={refresh}>Try again</button>
          </p>
        ) : (
          <div className={styles.skeleton} aria-label={loading ? "Loading" : undefined} />
        )}
      </div>
    )
  }

  const active = summary.projects.filter((project) => !project.archived)
  const conversations = active.reduce((sum, project) => sum + project.conversations30d, 0)
  const toReview = summary.review.toReview
  const base = `/admin/organisations/${orgId}`

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{summary.name}</h1>
          <p className={styles.subtitle}>
            {active.length} active project{active.length === 1 ? "" : "s"} · {summary.memberCount} member{summary.memberCount === 1 ? "" : "s"}
          </p>
        </div>
        <div className={styles.actions}>
          <Link className={styles.primary} href={`${base}/applications`}>
            {toReview ? `Review ${toReview} application${toReview === 1 ? "" : "s"}` : "Open applications"}
          </Link>
        </div>
      </header>

      {!summary.review.available ? (
        <p className={styles.notice}>
          Review figures aren&apos;t available yet: the application review database update hasn&apos;t been applied.
        </p>
      ) : null}

      <dl className={styles.stats}>
        <div className={styles.stat}>
          <dt>To review</dt>
          <dd className={toReview ? styles.attention : styles.dim}>{summary.review.available ? toReview : "–"}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Conversations, 30 days</dt>
          <dd className={conversations ? "" : styles.dim}>{conversations}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Decided, 7 days</dt>
          <dd className={summary.review.decidedLast7Days ? "" : styles.dim}>{summary.review.available ? summary.review.decidedLast7Days : "–"}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Median time to decision</dt>
          <dd className={summary.review.medianHoursToDecision === null ? styles.dim : ""}>{hoursLabel(summary.review.medianHoursToDecision)}</dd>
        </div>
      </dl>

      <section className={styles.section} aria-labelledby="active-projects">
        <div className={styles.sectionHeader}>
          <h2 id="active-projects" className={styles.sectionTitle}>Active projects</h2>
          <Link className={styles.link} href={`${base}/projects`}>View all</Link>
        </div>
        {active.length ? (
          <div className={styles.table}>
            <div className={styles.tableInner}>
              <div className={styles.head} style={COLUMNS}>
                <span>Project</span>
                <span>Persona</span>
                <span className={styles.num}>Conversations, 30d</span>
                <span className={styles.num}>To review</span>
                <span>Last activity</span>
              </div>
              {active.map((project) => {
                const status = projectStatus(project)
                return (
                  <Link key={project.id} className={styles.row} style={COLUMNS} href={`${base}/applications?project=${project.id}`}>
                    <span className={styles.name}>
                      <span className={status.dot} aria-label={status.label} role="img" />
                      {project.name}
                    </span>
                    <span className={styles.secondaryText}>{project.personaName ?? "Workspace default"}</span>
                    <span className={`${styles.num} ${project.conversations30d ? "" : styles.dim}`}>{project.conversations30d}</span>
                    <span className={`${styles.num} ${project.toReview ? styles.attention : styles.dim}`}>{project.toReview ?? "–"}</span>
                    <span className={styles.secondaryText}>{project.lastActivityAt ? relative(project.lastActivityAt) : "No conversations yet"}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        ) : (
          <p className={styles.empty}>No active projects. Create one from Projects.</p>
        )}
      </section>

      <div className={styles.columns}>
        <section className={styles.section} aria-labelledby="personas-in-use">
          <div className={styles.sectionHeader}>
            <h2 id="personas-in-use" className={styles.sectionTitle}>Personas in use</h2>
            <Link className={styles.link} href={`${base}/personas`}>Manage</Link>
          </div>
          {summary.personasInUse.length ? (
            <ul className={styles.list}>
              {summary.personasInUse.map((persona) => (
                <li key={persona.id}>
                  <span>{persona.name}</span>
                  <span className={styles.listMeta}>{persona.projects.join(", ")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>Projects without a persona use the workspace default.</p>
          )}
        </section>
        <section className={styles.section} aria-labelledby="recent-decisions">
          <h2 id="recent-decisions" className={styles.sectionTitle}>Recent decisions</h2>
          {summary.review.recentDecisions.length ? (
            <ul className={styles.list}>
              {summary.review.recentDecisions.map((decision) => (
                <li key={decision.id}>
                  <span className={styles.status} style={{ color: "var(--foreground)" }}>
                    <span className={decision.decision === "approved" ? styles.dotLive : styles.dotDanger} aria-hidden="true" />
                    {decision.applicant}
                  </span>
                  <span className={styles.listMeta}>
                    {decision.decision === "approved" ? "Approved" : "Declined"}
                    {decision.source === "policy" ? " by policy" : decision.reviewer ? ` by ${decision.reviewer}` : ""} · {relative(decision.decidedAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>No decisions yet. Approvals and declines appear here with who made them.</p>
          )}
        </section>
      </div>
    </div>
  )
}
