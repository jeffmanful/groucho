"use client"

import Link from "next/link"
import { durationSince } from "@/lib/relative-time"
import type { Cohort } from "@/lib/cohorts"
import { useOrganisationProject } from "./OrganisationProjectContext"
import { useOrganisationSummary } from "./OrganisationSummaryContext"
import { useProjectOverview } from "./ProjectOverviewContext"
import { ProjectObjective } from "./ProjectObjective"
import dashboard from "./dashboard.module.css"
import styles from "./project-overview.module.css"

function cohortStatus(cohort: Cohort) {
  if (cohort.drawnAt) return "Drawn"
  if (cohort.lockedAt) return "Locked"
  if (cohort.capacity !== null && cohort.members >= cohort.capacity) return "Full"
  return cohort.capacity === null ? "Open" : "Building"
}

export function ProjectOverview() {
  const { orgId, summary } = useOrganisationSummary()
  const { project, href } = useOrganisationProject()
  const { data, error, loading } = useProjectOverview()
  const base = `/admin/organisations/${orgId}`
  return (
    <div className={styles.page}>
      <header className={dashboard.header}>
        <div><h1 className={styles.title}>Project overview</h1><p className={dashboard.subtitle}>{project?.name}</p></div>
      </header>
      <ProjectObjective />
      {!data && !error ? <div className={dashboard.skeleton} style={{ height: 280 }} role="status" aria-label="Loading cohort progress and applications" /> : null}
      {data ? <div className={styles.columns} aria-busy={loading}>
        <section className={`${styles.card} ${styles.cohorts}`} aria-labelledby="overview-cohorts">
          <div className={styles.cardHeader}>
            <h2 id="overview-cohorts" className={styles.sectionTitle}>Your cohorts</h2>
            <Link className={styles.textLink} href={href(`${base}/applications/cohorts`)}>View cohorts</Link>
          </div>
          {data.cohorts.length ? <ul className={styles.cohortList}>
            {data.cohorts.map((cohort) => <li key={cohort.id} className={styles.cohort}>
              <div className={styles.cardHeader}>
                <Link className={styles.cohortName} href={href(`${base}/applications/cohorts?cohort=${cohort.id}`)}>{cohort.name}</Link>
                <span className={styles.meta}>{cohortStatus(cohort)}</span>
              </div>
              <div className={styles.cardHeader}>
                <span className={styles.number}>{cohort.members.toLocaleString()}{cohort.capacity !== null ? ` / ${cohort.capacity.toLocaleString()}` : ""} people added</span>
                <span className={styles.meta}>{cohort.capacity !== null ? `${Math.max(0, cohort.capacity - cohort.members).toLocaleString()} places remaining` : "No capacity set"}</span>
              </div>
              {cohort.capacity !== null ? <progress className={styles.progress} aria-label={`${cohort.name} places filled`} value={Math.min(cohort.members, cohort.capacity)} max={cohort.capacity} /> : null}
            </li>)}
          </ul> : <div className={styles.empty}>
            <p>No cohorts yet.</p>
            <p className={styles.secondary}>{summary?.canManage ? "Create a cohort to start placing approved people." : "Your team can create cohorts to group approved people."}</p>
            {summary?.canManage ? <Link className={dashboard.secondary} href={href(`${base}/applications/cohorts?new=1`)}>Create a cohort</Link> : null}
          </div>}
          {data.unallocated > 0 ? <div className={styles.unallocated}>
            <p className={styles.secondary}>{data.unallocated.toLocaleString()} approved {data.unallocated === 1 ? "person is" : "people are"} waiting to be placed in a cohort.</p>
            <Link className={dashboard.secondary} href={href(`${base}/applications/cohorts`)}>{summary?.canManage ? "Place approved people" : "View approved people"}</Link>
          </div> : null}
        </section>
        <section className={`${styles.card} ${styles.reviewWork}`} aria-labelledby="overview-review">
          <h2 id="overview-review" className={styles.sectionTitle}><span className={styles.desktopTitle}>Applications to review</span><span className={styles.mobileTitle}>{data.review.ready.toLocaleString()} ready for review</span></h2>
          <div className={styles.reviewMetric}><p className={styles.reviewCount}>{data.review.ready.toLocaleString()}</p><p className={styles.secondary}>{data.review.ready ? "Ready for a decision" : "No applications ready for review"}</p></div>
          <Link className={dashboard.primary} href={href(data.review.ready ? `${base}/applications?queue=ready_for_review&sort=longest_waiting` : `${base}/applications`)}>
            {data.review.ready ? `Review ${data.review.ready.toLocaleString()} ${data.review.ready === 1 ? "application" : "applications"}` : "View all applications"}
          </Link>
          <div className={styles.reviewMeta}>
            {data.review.oldestPendingSince ? <p className={`${styles.meta} ${styles.oldest}`}>Oldest waiting: {durationSince(data.review.oldestPendingSince)}</p> : null}
            <p className={styles.meta}>{data.review.awaitingAssessment.toLocaleString()} {data.review.ready ? "more " : ""}awaiting assessment</p>
          </div>
        </section>
      </div> : null}
    </div>
  )
}
