"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"
import { useOrganisationProject } from "@/components/admin/dashboard/OrganisationProjectContext"
import { useOrganisationSummary } from "@/components/admin/dashboard/OrganisationSummaryContext"
import dashboard from "@/components/admin/dashboard/dashboard.module.css"
import styles from "./applications-section.module.css"

export function ApplicationsSection({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { orgId } = useOrganisationSummary()
  const { href, project } = useOrganisationProject()
  const base = `/admin/organisations/${orgId}/applications`
  const tabs = [
    { path: base, label: "Review" },
    { path: `${base}/entries`, label: "Entries" },
    { path: `${base}/cohorts`, label: "Cohorts" },
    { path: `${base}/decisions`, label: "Decisions" },
  ]
  const active = tabs.find((tab) => tab.path !== base && pathname === tab.path)?.path ?? base

  return (
    <div className={styles.workspace}>
      <header>
        <h1 className={dashboard.title}>Applications</h1>
        <p className={dashboard.subtitle}>Review applicants, manage entries and cohorts, and track decisions.</p>
      </header>
      <nav className={styles.tabs} aria-label="Applications">
        {tabs.map((tab) => (
          <Link key={tab.path} href={href(tab.path)} aria-current={active === tab.path ? "page" : undefined} className={styles.tab}>
            {tab.label}
            {tab.path === base && project?.toReview ? <span className={styles.count} aria-label={`${project.toReview} ready for review`}>{project.toReview}</span> : null}
          </Link>
        ))}
      </nav>
      <div className={styles.content}>{children}</div>
    </div>
  )
}
