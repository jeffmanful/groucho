"use client"

import Link from "next/link"
import { useEffect, useState, type CSSProperties } from "react"
import { useOrganisationSummary } from "@/components/admin/dashboard/OrganisationSummaryContext"
import dashboard from "@/components/admin/dashboard/dashboard.module.css"
import type { DecisionLedger, LedgerEntry, LedgerFilter } from "@/lib/decision-ledger"
import { OUTCOME_LABELS, type ApplicationOutcome } from "@/lib/outcome-labels"
import { shortDate } from "@/lib/relative-time"
import styles from "./client.module.css"

const FILTERS: Array<{ value: LedgerFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "approved", label: "Approved" },
  { value: "declined", label: "Declined" },
  { value: "corrected", label: "Corrected" },
]
const PAGE = 50

function by(entry: LedgerEntry): { who: string; where: string | null } {
  const decision = entry.decision
  if (!decision) return { who: "–", where: null }
  if (decision.via === "policy") return { who: "Your rules", where: null }
  return { who: decision.reviewer ?? "A reviewer", where: decision.via === "api" ? "Your app" : "Dashboard" }
}

function outcomeDot(outcome: string | undefined): string {
  if (outcome === "joined" || outcome === "active") return styles.dotSuccess
  if (outcome === "invited") return styles.dotSelection
  if (outcome === "no_response" || outcome === "inactive" || outcome === "invite_declined") return styles.dotWarning
  if (outcome === "left" || outcome === "removed") return styles.dotDanger
  return ""
}

export function Decisions() {
  const { orgId } = useOrganisationSummary()
  const [filter, setFilter] = useState<LedgerFilter>("all")
  const [search, setSearch] = useState("")
  const [query, setQuery] = useState("")
  const [offset, setOffset] = useState(0)
  const [state, setState] = useState<{ key: string; data?: DecisionLedger; error?: string } | null>(null)
  const key = `${orgId}|${filter}|${query}|${offset}`

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim())
      setOffset(0)
    }, 250)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    const params = new URLSearchParams({ filter, offset: String(offset), limit: String(PAGE) })
    if (query) params.set("q", query)
    fetch(`/api/admin/organisations/${orgId}/decisions?${params}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Decisions could not be loaded.")
        if (!cancelled) setState({ key, data: body as DecisionLedger })
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ key, error: error.message })
      })
    return () => {
      cancelled = true
    }
  }, [orgId, filter, query, offset, key])

  const data = state?.data
  const loading = state?.key !== key
  const multipleProjects = (data?.projects.length ?? 0) > 1
  const columns = {
    "--columns": multipleProjects
      ? "minmax(0,1.5fr) minmax(0,1fr) minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr) 80px"
      : "minmax(0,1.6fr) minmax(0,1fr) minmax(0,1.4fr) minmax(0,1.1fr) 80px",
  } as CSSProperties
  const stats = data?.stats
  const joinedShare = stats && stats.joined !== null && stats.approved ? Math.round((stats.joined / stats.approved) * 100) : null

  return (
    <div className={dashboard.page}>
      <header className={dashboard.header}>
        <h1 className={dashboard.title}>Decisions</h1>
      </header>

      {stats ? (
        <div className={`${styles.panel} ${styles.stats}`}>
          <div className={styles.stat}>
            <span className={styles.secondary}>Approved</span>
            <span className={styles.statValue}>{stats.approved}</span>
            <span className={`${styles.muted} ${styles.small}`}>
              {stats.joined === null
                ? "Joining is reported by your system"
                : stats.outcomesReported
                  ? `${stats.joined} joined · ${joinedShare}%`
                  : "Your system hasn't reported who joined yet"}
            </span>
          </div>
          <div className={styles.stat}>
            <span className={styles.secondary}>Declined</span>
            <span className={styles.statValue}>{stats.declined}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.secondary}>Corrected</span>
            <span className={styles.statValue}>{stats.corrected ?? "–"}</span>
          </div>
        </div>
      ) : null}

      <div className={styles.toolbar}>
        <div className={styles.segment} role="group" aria-label="Show">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              onClick={() => {
                setFilter(option.value)
                setOffset(0)
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        <input
          className={styles.search}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search people"
          aria-label="Search people"
        />
      </div>

      {state?.error ? <p className={dashboard.error} role="alert">{state.error}</p> : null}

      <div className={`${styles.panel} ${styles.ledger}`} aria-busy={loading}>
        <div className={styles.ledgerInner}>
          <div className={styles.ledgerHead} style={columns}>
            <span>Person</span>
            <span>Decision</span>
            <span>By</span>
            {multipleProjects ? <span>Project</span> : null}
            <span>Since then</span>
            <span>Decided</span>
          </div>
          {(data?.entries ?? []).map((entry) => {
            // Only what happened after the decision in force (a correction can come after a join).
            const outcome =
              entry.latestOutcome &&
              (!entry.latestOutcome.at || !entry.decision?.decidedAt || Date.parse(entry.latestOutcome.at) >= Date.parse(entry.decision.decidedAt))
                ? entry.latestOutcome.outcome
                : undefined
            return (
              <Link
                key={entry.id}
                href={`/admin/organisations/${orgId}/applications/${entry.projectId}/${entry.id}`}
                className={styles.rowLink}
                style={columns}
              >
                <span className={styles.person}>
                  <span className={styles.truncate}>{entry.applicant.name ?? entry.applicant.email ?? "Applicant"}</span>
                  {entry.applicant.name && entry.applicant.email ? (
                    <span className={`${styles.muted} ${styles.small} ${styles.truncate}`}>{entry.applicant.email}</span>
                  ) : null}
                </span>
                <span className={styles.status}>
                  <span className={`${styles.dot} ${entry.decision?.decision === "approved" ? styles.dotSuccess : styles.dotDanger}`} aria-hidden="true" />
                  {entry.decision?.decision === "approved" ? "Approved" : "Declined"}
                  {entry.decision?.corrected ? <span className={styles.badge}>Corrected</span> : null}
                </span>
                <span className={styles.person}>
                  <span className={`${styles.secondary} ${styles.truncate}`}>{by(entry).who}</span>
                  {by(entry).where ? <span className={`${styles.muted} ${styles.small}`}>{by(entry).where}</span> : null}
                </span>
                {multipleProjects ? <span className={`${styles.secondary} ${styles.truncate}`}>{entry.projectName}</span> : null}
                <span className={`${styles.status} ${styles.secondary}`}>
                  {outcome ? (
                    <>
                      <span className={`${styles.dot} ${outcomeDot(outcome)}`} aria-hidden="true" />
                      {OUTCOME_LABELS[outcome as ApplicationOutcome] ?? outcome}
                    </>
                  ) : (
                    <span className={styles.muted}>–</span>
                  )}
                </span>
                <span className={styles.muted}>{shortDate(entry.decision?.decidedAt)}</span>
              </Link>
            )
          })}
          {data && !data.entries.length ? (
            <p className={styles.muted} style={{ margin: 0, padding: "18px 16px" }}>
              {query || filter !== "all" ? "No decisions match." : "No decisions yet."}
            </p>
          ) : null}
        </div>
      </div>

      {data && data.total > PAGE ? (
        <div className={styles.pager}>
          <span className={styles.muted}>
            {offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total}
          </span>
          <button type="button" className={styles.button} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            Previous
          </button>
          <button type="button" className={styles.button} disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>
            Next
          </button>
        </div>
      ) : null}
    </div>
  )
}
