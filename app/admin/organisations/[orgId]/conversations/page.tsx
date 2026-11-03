"use client"

import { useMemo } from "react"
import LiveConversations from "@/components/admin/LiveConversations"
import { useOrganisationProject } from "@/components/admin/dashboard/OrganisationProjectContext"
import { useOrganisationSummary } from "@/components/admin/dashboard/OrganisationSummaryContext"
import styles from "@/components/admin/dashboard/dashboard.module.css"

export default function ConversationsPage() {
  const { project } = useOrganisationProject()
  const { orgId, summary } = useOrganisationSummary()
  const option = useMemo(() => project && orgId ? {
    id: project.id, name: project.name, organisationId: orgId,
    organisationName: summary?.name ?? "", activeSessions: project.activeNow,
  } : null, [project, orgId, summary?.name])
  return <>
    <header className={styles.page}>
      <h1 className={styles.title}>Conversations</h1>
      <p className={styles.subtitle}>Read each conversation and the report Groucho wrote about it.</p>
    </header>
    {option ? <LiveConversations project={option} /> : null}
  </>
}
