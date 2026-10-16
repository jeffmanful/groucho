"use client"

import Link from "next/link"
import { useState } from "react"
import { ArrowRight, ArrowUpRight, Tickets } from "lucide-react"
import { MetricCard } from "@/components/arc/metric-card/metric-card"
import { SortableDataTable } from "@/components/arc/sortable-data-table/sortable-data-table"
import { SearchField } from "@/components/arc/search-field/search-field"
import { Badge } from "@/components/arc/badge/badge"
import { Skeleton } from "@/components/arc/skeleton/skeleton"
import { Button } from "@/components/arc/button/button"
import { useAdminWorkspace } from "@/components/admin/AdminWorkspace"
import styles from "./admin-workspace.module.css"

const projectType = {
  gatekeeper: "Gatekeeper",
  onboarding: "Onboarding",
  ticket_access: "Ticket access",
}
function dateLabel(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : date.toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/London",
      })
}
export default function AdminDashboard() {
  const { data, loading, error, retry } = useAdminWorkspace()
  const [query, setQuery] = useState("")
  const [organisation, setOrganisation] = useState("all")
  const allProjects =
    data?.organisations.flatMap((o) =>
      o.projects.map((p) => ({
        ...p,
        orgName: o.name,
        canEdit: o.canCreateProject,
      })),
    ) ?? []
  const projects = allProjects.filter(
    (p) =>
      (organisation === "all" || organisation === p.organisationId) &&
      `${p.name} ${p.slug} ${p.orgName} ${projectType[p.projectType]}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  )
  const workspaceHref = (p: (typeof projects)[number]) =>
    p.projectType === "ticket_access"
      ? `/admin/ticket-access?project=${p.id}&org=${p.organisationId}`
      : `/admin/organisations/${p.organisationId}?project=${p.id}`
  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1>Workspace overview</h1>
          <p>Manage projects and review recent conversations.</p>
        </div>
        <Link href="/admin/sessions?view=report">
          Open reports{" "}
          <ArrowUpRight size={16} aria-hidden="true" strokeWidth={1.75} />
        </Link>
      </header>
      {error && (
        <section className={styles.error} role="alert">
          <h2>We could not load your workspace</h2>
          <p>{error}</p>
          <Button variant="secondary" loading={loading} onClick={retry}>
            Try again
          </Button>
        </section>
      )}
      {loading && !data && !error && (
        <section aria-label="Loading workspace" aria-busy="true">
          <div className={styles.metrics}>
            {[0, 1, 2, 3].map((n) => (
              <div className={styles.loading} key={n}>
                <Skeleton label="Loading workspace totals" lines={3} />
              </div>
            ))}
          </div>
          <div className={styles.loading}>
            <Skeleton label="Loading projects" lines={6} />
          </div>
        </section>
      )}
      {data && (
        <>
          <section className={styles.metrics} aria-label="Workspace totals">
            <MetricCard
              label="Projects"
              value={data.stats.projects}
              context={`${data.stats.organisations} organisations`}
            />
            <MetricCard
              label="Active sessions"
              value={data.stats.activeSessions}
              context="Conversations in progress"
            />
            <MetricCard
              label="Sessions today"
              value={data.stats.sessionsToday}
              context="Started since midnight"
            />
            <MetricCard
              label="Completed today"
              value={data.stats.completedSessionsToday}
              context="Conversation completions"
            />
          </section>
          <section
            className={styles.projectSection}
            aria-labelledby="projects-heading"
          >
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="projects-heading">Projects</h2>
                <Badge tone="neutral" size="sm">
                  {allProjects.length}
                </Badge>
              </div>
              <Link href="/admin/organisations" className={styles.textLink}>
                Manage organisations{" "}
                <ArrowUpRight size={16} aria-hidden="true" strokeWidth={1.75} />
              </Link>
            </div>
            {allProjects.length ? (
              <>
                <div className={styles.filters}>
                  <SearchField
                    label="Search projects"
                    placeholder="Project, organisation or type"
                    value={query}
                    onValueChange={setQuery}
                  />
                  <label>
                    Organisation
                    <select
                      value={organisation}
                      onChange={(e) => setOrganisation(e.target.value)}
                    >
                      <option value="all">All organisations</option>
                      {data.organisations.map((o) => (
                        <option value={o.id} key={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <SortableDataTable
                  rows={projects}
                  rowKey="id"
                  caption="Workspace projects"
                  emptyMessage="No projects match. Clear your search or choose another organisation."
                  defaultSort={{ key: "name", direction: "asc" }}
                  itemName={{ one: "project", other: "projects" }}
                  columns={[
                    {
                      key: "name",
                      label: "Project",
                      render: (_, p) => (
                        <div className={styles.cell}>
                          <Link
                            className={styles.projectName}
                            href={workspaceHref(p)}
                          >
                            {p.name}
                            <ArrowUpRight
                              size={14}
                              aria-hidden="true"
                              strokeWidth={1.75}
                            />
                          </Link>
                          <small>{p.slug}</small>
                        </div>
                      ),
                    },
                    { key: "orgName", label: "Organisation" },
                    {
                      key: "projectType",
                      label: "Type",
                      render: (_, p) => (
                        <Badge tone="neutral" size="sm">
                          {projectType[p.projectType]}
                        </Badge>
                      ),
                    },
                    {
                      key: "environment",
                      label: "Environment",
                      render: (_, p) => (
                        <Badge tone="neutral" size="sm">
                          {p.projectType === "ticket_access"
                            ? "Simulation"
                            : p.environment === "live"
                            ? "Live"
                            : p.environment === "test"
                            ? "Test"
                            : "Not set"}
                        </Badge>
                      ),
                    },
                    {
                      key: "activeSessions",
                      label: "Active",
                      numeric: true,
                      render: (_, p) =>
                        p.projectType === "ticket_access" ? (
                          <span className={styles.muted}>Demo only</span>
                        ) : (
                          p.activeSessions
                        ),
                    },
                    {
                      key: "actions",
                      label: "Actions",
                      sortable: false,
                      render: (_, p) => (
                        <div className={styles.tableActions}>
                          <Link
                            href={workspaceHref(p)}
                            aria-label={`Open ${p.name}`}
                          >
                            Open
                          </Link>
                          {p.canEdit && (
                            <Link
                              href={`/admin/organisations/${p.organisationId}/projects/${p.id}/edit`}
                              aria-label={`Configure ${p.name}`}
                            >
                              Configure
                            </Link>
                          )}
                        </div>
                      ),
                    },
                  ]}
                />
              </>
            ) : (
              <div className={styles.empty}>
                <h2>
                  {data.organisations.length
                    ? "Build your first project"
                    : "Your workspace starts with an organisation"}
                </h2>
                <p>
                  {data.organisations.length
                    ? "Create a conversation experience or a synthetic ticket-access pilot."
                    : "Create an organisation or accept an invitation to get started."}
                </p>
                {data.organisations.some((o) => o.canCreateProject) ? (
                  <Link
                    className={styles.secondaryLink}
                    href="/admin/projects/new"
                  >
                    Create a project
                  </Link>
                ) : (
                  <Link
                    className={styles.secondaryLink}
                    href={
                      data.actor.isPlatform
                        ? "/admin/organisations"
                        : "/signup/organisation"
                    }
                  >
                    {data.actor.isPlatform
                      ? "Manage organisations"
                      : "Create an organisation"}
                  </Link>
                )}
              </div>
            )}
          </section>
          <section className={styles.pilot} aria-labelledby="pilot-heading">
            <Tickets size={24} strokeWidth={1.75} aria-hidden="true" />
            <div>
              <h2 id="pilot-heading">Ticket access pilot</h2>
              <p>
                Explore the ticket-access pilot with synthetic registrations,
                evidence review and a cohort lottery.
              </p>
            </div>
            <Link href="/admin/ticket-access" className={styles.secondaryLink}>
              Explore the demo{" "}
              <ArrowRight size={16} aria-hidden="true" strokeWidth={1.75} />
            </Link>
          </section>
          <section
            className={styles.activity}
            aria-labelledby="activity-heading"
          >
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="activity-heading">Recent conversations</h2>
              </div>
              <Link href="/admin/sessions">
                View all{" "}
                <ArrowRight size={16} aria-hidden="true" strokeWidth={1.75} />
              </Link>
            </div>
            <p className={styles.muted}>
              Conversation outcomes are advisory. Recorded approval decisions
              are available in each project’s review.
            </p>
            {data.recentSessions.length ? (
              <ul className={styles.activityList}>
                {data.recentSessions.map((s) => (
                  <li key={s.id}>
                    <div>
                      <Link
                        href={`/admin/organisations/${s.orgId}?project=${s.projectId}&session=${s.id}`}
                      >
                        {s.projectName}
                      </Link>
                      <p>
                        {s.orgName} · {s.clientSessionKey.slice(0, 12)}
                      </p>
                    </div>
                    <Badge tone="neutral" size="sm">
                      {s.status === "active"
                        ? "In progress"
                        : s.status === "passed"
                        ? "Passed · advisory"
                        : s.status === "rejected"
                        ? "Rejected · advisory"
                        : s.status === "redirected"
                        ? "Redirected · advisory"
                        : s.status}
                    </Badge>
                    <time dateTime={s.updatedAt}>{dateLabel(s.updatedAt)}</time>
                    <Link
                      href={`/admin/sessions?project=${s.projectId}&session=${s.id}&view=report`}
                      className={styles.textLink}
                      aria-label={`Review conversation ${s.clientSessionKey}`}
                    >
                      Review{" "}
                      <ArrowUpRight
                        size={14}
                        aria-hidden="true"
                        strokeWidth={1.75}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={styles.empty}>
                <h2>No conversations yet</h2>
                <p>
                  When people engage with a project, their latest conversations
                  will appear here.
                </p>
                <Link className={styles.secondaryLink} href="/admin/sessions">
                  Open sessions
                </Link>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}
