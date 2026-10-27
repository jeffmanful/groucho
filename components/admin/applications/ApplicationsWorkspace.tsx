"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { RefObject } from "react"
import { Download, RefreshCw, X } from "lucide-react"
import { Badge, type BadgeTone } from "@/components/arc/badge/badge"
import { Button } from "@/components/arc/button/button"
import { SearchField } from "@/components/arc/search-field/search-field"
import { ReviewerReportView } from "@/components/admin/ReviewerReportView"
import {
  apiSource,
  DEFAULT_FILTERS,
  PAGE_SIZE,
  QUEUE_LABEL,
  QUEUE_ORDER,
  type ApplicationDetail,
  type ApplicationFilters,
  type ApplicationItem,
  type ApplicationsPage,
  type ApplicationsSource,
  type ProjectChoice,
  type QueueKey,
} from "@/lib/applications-source"
import { DEMO_PROJECT, demoSource } from "@/lib/demo-applications"
import styles from "./applications-workspace.module.css"

const PROJECT_KEY = "groucho_applications_project"

const RECOMMENDATION_LABEL = { recommend: "Recommend", human_review: "Needs a closer look", decline: "Decline" } as const
const RECOMMENDATION_TONE: Record<keyof typeof RECOMMENDATION_LABEL, BadgeTone> = { recommend: "success", human_review: "warning", decline: "danger" }
const BAND_LABEL = { recommended_acceptance: "Acceptance band", review: "Review band", below_threshold: "Below threshold" } as const
const BAND_SHORT = { recommended_acceptance: "Accept", review: "Review", below_threshold: "Below" } as const
const QUEUE_TONE: Record<Exclude<QueueKey, "all">, BadgeTone> = {
  ready_for_review: "info", awaiting_assessment: "neutral", in_progress: "neutral", approved: "success", declined: "danger", abandoned: "neutral",
}

type OverviewResponse = {
  organisations?: Array<{ id: string; name: string; canCreateProject?: boolean; projects?: Array<{ id: string; name: string; organisationId: string; projectType?: string }> }>
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—"
  return new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

function daysSince(value: string | null): number {
  if (!value) return 0
  return Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 86_400_000))
}

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}`
}

function applicantLabel(item: ApplicationItem): string {
  return item.applicant.name || item.applicant.email || item.sessionKey.slice(0, 8)
}

function download(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function decisionAttribution(decision: NonNullable<ApplicationItem["decision"]>): string {
  if (decision.source === "policy" || decision.via === "policy") return "Automatically, by your decision policy"
  if (decision.via === "api") return decision.reviewer ? `By ${decision.reviewer} in your app` : "In your app"
  return `By ${decision.reviewer ?? "a reviewer"}`
}

export function ApplicationsWorkspace({ organisationId }: { organisationId?: string } = {}) {
  const [projects, setProjects] = useState<ProjectChoice[]>([DEMO_PROJECT])
  const [projectId, setProjectId] = useState<string>("")
  const [filters, setFilters] = useState<ApplicationFilters>(DEFAULT_FILTERS)
  const [searchDraft, setSearchDraft] = useState("")
  const [refreshToken, setRefreshToken] = useState(0)
  // The latest list result and the request it answers; "loading" is a mismatch with the current request.
  const [result, setResult] = useState<{ key: string; page?: ApplicationsPage; error?: string } | null>(null)
  // The application last opened; the list's copy of it is preferred once it reloads.
  const [opened, setOpened] = useState<ApplicationItem | null>(null)
  const [detail, setDetail] = useState<ApplicationDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [view, setView] = useState<"summary" | "conversation" | "applicant">("summary")
  const [reason, setReason] = useState("")
  const [pendingDecision, setPendingDecision] = useState<"approved" | "declined" | null>(null)
  const [deciding, setDeciding] = useState(false)
  const [decisionError, setDecisionError] = useState<string | null>(null)
  const searchTimer = useRef<number | undefined>(undefined)
  // Only the latest opened application's detail may land in the panel.
  const detailRequest = useRef(0)
  const confirmGroup = useRef<HTMLDivElement | null>(null)
  const decisionActions = useRef<HTMLDivElement | null>(null)
  const returnFocus = useRef(false)

  const project = useMemo(() => projects.find((candidate) => candidate.id === projectId) ?? null, [projects, projectId])
  const source = useMemo<ApplicationsSource | null>(() => {
    if (!project) return null
    return project.demo ? demoSource() : apiSource(project)
  }, [project])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const response = await fetch("/api/admin/overview").catch(() => null)
      const payload = response?.ok ? await response.json() as OverviewResponse : {}
      if (cancelled) return
      const real = (payload.organisations ?? [])
        .filter((organisation) => !organisationId || organisation.id === organisationId)
        .flatMap((organisation) =>
        (organisation.projects ?? [])
          .filter((candidate) => (candidate.projectType ?? "gatekeeper") === "gatekeeper")
          .map((candidate) => ({ id: candidate.id, organisationId: candidate.organisationId || organisation.id, name: candidate.name, organisationName: organisation.name, canDecide: organisation.canCreateProject === true })))
      // Inside an organisation only its projects are offered; the sample project lives with the demos.
      const all = organisationId ? real : [...real, DEMO_PROJECT]
      setProjects(all)
      const requested = new URLSearchParams(window.location.search).get("project")
      let remembered: string | null = null
      try { remembered = window.localStorage.getItem(PROJECT_KEY) } catch { /* storage unavailable */ }
      const initial = all.find((candidate) => candidate.id === requested) ?? all.find((candidate) => candidate.id === remembered) ?? all[0]
      setProjectId(initial?.id ?? "")
    })()
    return () => { cancelled = true }
  }, [organisationId])

  function changeSearch(value: string) {
    setSearchDraft(value)
    window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => {
      setFilters((current) => current.search === value ? current : { ...current, search: value, offset: 0 })
    }, 250)
  }

  // Keep keyboard focus on the decision step: Confirm when it opens, Approve when cancelled.
  // The Arc Button's motion wrapper doesn't reliably hand its element to a forwarded ref, so focus goes
  // through the surrounding group instead, a frame later once the swap has committed.
  useEffect(() => {
    let target: RefObject<HTMLDivElement | null> | null = null
    if (pendingDecision) target = confirmGroup
    else if (returnFocus.current) {
      returnFocus.current = false
      target = decisionActions
    }
    if (!target) return
    const frame = window.requestAnimationFrame(() => target.current?.querySelector("button")?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [pendingDecision])

  const requestKey = `${projectId}|${JSON.stringify(filters)}|${refreshToken}`
  useEffect(() => {
    if (!source) return
    let cancelled = false
    source.list(filters).then(
      (next) => { if (!cancelled) setResult({ key: requestKey, page: next }) },
      (loadError) => {
        if (!cancelled) setResult((current) => ({ key: requestKey, page: current?.page, error: loadError instanceof Error ? loadError.message : "Could not load applications." }))
      },
    )
    return () => { cancelled = true }
  }, [filters, requestKey, source])
  const page = result?.page ?? null
  const loading = Boolean(source) && result?.key !== requestKey
  const error = result?.key === requestKey ? result.error ?? null : null
  const refresh = () => setRefreshToken((token) => token + 1)

  const selected = opened ? page?.applications.find((item) => item.id === opened.id) ?? opened : null

  const openApplication = useCallback(async (item: ApplicationItem) => {
    if (!source) return
    const request = ++detailRequest.current
    setOpened(item)
    setDetail(null)
    setDetailError(null)
    setReason("")
    setPendingDecision(null)
    setDecisionError(null)
    setDetailLoading(true)
    try {
      const next = await source.detail(item)
      if (request === detailRequest.current) setDetail(next)
    } catch (loadError) {
      if (request === detailRequest.current) setDetailError(loadError instanceof Error ? loadError.message : "Could not load this application.")
    } finally {
      if (request === detailRequest.current) setDetailLoading(false)
    }
  }, [source])

  function chooseProject(id: string) {
    detailRequest.current++
    setProjectId(id)
    setFilters(DEFAULT_FILTERS)
    setSearchDraft("")
    setResult(null)
    setOpened(null)
    setDetail(null)
    try { window.localStorage.setItem(PROJECT_KEY, id) } catch { /* storage unavailable */ }
  }

  function update(patch: Partial<ApplicationFilters>) {
    setFilters((current) => ({ ...current, ...patch, offset: "offset" in patch ? patch.offset ?? 0 : 0 }))
  }

  const filtersActive = filters.audience !== "all" || filters.recommendation !== "all" || filters.band !== "all" ||
    Boolean(filters.from) || Boolean(filters.to) || Boolean(filters.search)

  async function exportCsv() {
    if (!source) return
    const result = await source.exportCsv(filters)
    if ("url" in result) window.location.assign(result.url)
    else download(result.filename, result.csv)
  }

  async function confirmDecision() {
    if (!source || !selected || !pendingDecision) return
    if (pendingDecision === "declined" && !reason.trim()) {
      setDecisionError("Add a reason before declining. It is kept with the decision.")
      return
    }
    setDeciding(true)
    setDecisionError(null)
    try {
      await source.decide(selected, pendingDecision, reason)
      setOpened({
        ...selected,
        queue: pendingDecision,
        decision: { decision: pendingDecision, source: "human", via: "dashboard", reviewer: "You", reason: reason.trim() || null, decidedAt: new Date().toISOString() },
      })
      setPendingDecision(null)
      setReason("")
      refresh()
    } catch (decideError) {
      setDecisionError(decideError instanceof Error ? decideError.message : "The decision could not be recorded.")
      // Someone else may have decided first; show the current state.
      refresh()
    } finally {
      setDeciding(false)
    }
  }

  const metrics = page?.metrics
  const counts = page?.counts
  const decidable = selected && !selected.decision && selected.status !== "active" && selected.status !== "abandoned"
  const canDecide = project?.canDecide === true

  // Deciding the last row on a page leaves the offset past the end; step back a page.
  if (page && !loading && filters.offset > 0 && filters.offset >= page.total) {
    const lastPage = Math.max(0, Math.floor(Math.max(page.total - 1, 0) / PAGE_SIZE) * PAGE_SIZE)
    if (lastPage !== filters.offset) setFilters((current) => ({ ...current, offset: lastPage }))
  }

  function startDecision(decision: "approved" | "declined") {
    returnFocus.current = false
    setPendingDecision(decision)
    setDecisionError(null)
  }

  function cancelDecision() {
    returnFocus.current = true
    setPendingDecision(null)
  }

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Applications</h1>
          <p className={styles.subtitle}>Review evidence, record decisions and track your queue. Groucho&apos;s assessment is advisory; only a reviewer or your enabled policy decides.</p>
        </div>
        <div className={styles.headerActions}>
          <label className={styles.field}>
            <span>Project</span>
            <select value={projectId} onChange={(event) => chooseProject(event.target.value)}>
              {projects.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.demo || organisationId ? candidate.name : `${candidate.organisationName} / ${candidate.name}`}
                </option>
              ))}
            </select>
          </label>
          <Button variant="secondary" size="sm" onClick={refresh} disabled={!source || loading} aria-label="Refresh applications">
            <RefreshCw size={14} aria-hidden="true" /> Refresh
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void exportCsv()} disabled={!source}>
            <Download size={14} aria-hidden="true" /> Export CSV
          </Button>
        </div>
      </header>

      {project?.demo ? (
        <p className={styles.demoNote} role="note">
          Sample project: fictional applicants whose conversations and reports were produced by Groucho. Decisions here are not saved and reset when you reload.
        </p>
      ) : null}

      <section className={styles.metrics} aria-label="Review workload">
        <div className={styles.metric}>
          <span>Awaiting review</span>
          <strong className={metrics?.awaitingReview ? styles.metricAttention : undefined}>{metrics?.awaitingReview ?? 0}</strong>
        </div>
        <div className={styles.metric}>
          <span>Oldest waiting</span>
          <strong>{metrics?.oldestPendingSince ? `${daysSince(metrics.oldestPendingSince)}\u00a0days` : "–"}</strong>
        </div>
        <div className={styles.metric}>
          <span>Decided, 7 days</span>
          <strong>{metrics?.decidedLast7Days ?? 0}</strong>
        </div>
        <div className={styles.metric}>
          <span>Median time to decision</span>
          <strong>{metrics?.medianHoursToDecision === null || metrics?.medianHoursToDecision === undefined ? "–" : `${metrics.medianHoursToDecision}\u00a0h`}</strong>
        </div>
      </section>

      <nav className={styles.queues} aria-label="Review queues">
        {QUEUE_ORDER.map((queue) => (
          <button
            key={queue}
            type="button"
            className={filters.queue === queue ? styles.queueActive : styles.queue}
            aria-pressed={filters.queue === queue}
            onClick={() => update({ queue })}
          >
            {QUEUE_LABEL[queue]}
            <span className={styles.queueCount}>{counts ? counts[queue] : "–"}</span>
          </button>
        ))}
      </nav>

      <section className={styles.filters} aria-label="Filters">
        <SearchField label="Search applicants" placeholder="Name, email or reference" value={searchDraft} onValueChange={changeSearch} className={styles.search} />
        <label className={styles.field}>
          <span>Applicant type</span>
          <select value={filters.audience} onChange={(event) => update({ audience: event.target.value as ApplicationFilters["audience"] })}>
            <option value="all">All</option>
            <option value="community">Community</option>
            <option value="artist">Artist</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Groucho&apos;s recommendation</span>
          <select value={filters.recommendation} onChange={(event) => update({ recommendation: event.target.value as ApplicationFilters["recommendation"] })}>
            <option value="all">Any</option>
            <option value="recommend">Recommend</option>
            <option value="human_review">Needs a closer look</option>
            <option value="decline">Decline</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Suitability</span>
          <select value={filters.band} onChange={(event) => update({ band: event.target.value as ApplicationFilters["band"] })}>
            <option value="all">Any</option>
            <option value="recommended_acceptance">Acceptance band</option>
            <option value="review">Review band</option>
            <option value="below_threshold">Below threshold</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Submitted from</span>
          <input type="date" value={filters.from} onChange={(event) => update({ from: event.target.value })} />
        </label>
        <label className={styles.field}>
          <span>to</span>
          <input type="date" value={filters.to} onChange={(event) => update({ to: event.target.value })} />
        </label>
        <label className={styles.field}>
          <span>Sort by</span>
          <select value={filters.sort} onChange={(event) => update({ sort: event.target.value as ApplicationFilters["sort"] })}>
            <option value="suitability">Suitability</option>
            <option value="longest_waiting">Longest waiting</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </label>
        {filtersActive ? (
          <Button variant="ghost" size="sm" onClick={() => { window.clearTimeout(searchTimer.current); setSearchDraft(""); update({ audience: "all", recommendation: "all", band: "all", from: "", to: "", search: "" }) }}>
            <X size={14} aria-hidden="true" /> Clear filters
          </Button>
        ) : null}
      </section>

      {error ? (
        <div className={styles.error} role="alert">
          {error} <Button variant="secondary" size="sm" onClick={refresh}>Try again</Button>
        </div>
      ) : null}

      <div className={styles.body}>
        <section className={styles.list} aria-label="Applications" aria-busy={loading}>
          <div className={styles.listHeader} aria-hidden="true">
            <span>Applicant</span><span>Submitted</span><span>Suitability</span><span>Recommendation</span><span>Status</span>
          </div>
          {!page && loading ? <p className={styles.empty}>Loading applications…</p> : null}
          {page && page.applications.length === 0 ? (
            <p className={styles.empty}>{filtersActive ? "No applications match these filters." : `No applications in “${QUEUE_LABEL[filters.queue]}”.`}</p>
          ) : null}
          <ul className={styles.rows}>
            {page?.applications.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={selected?.id === item.id ? styles.rowSelected : styles.row}
                  aria-current={selected?.id === item.id ? "true" : undefined}
                  onClick={() => void openApplication(item)}
                >
                  <span className={styles.applicant}>
                    <strong>{applicantLabel(item)}</strong>
                    <small>
                      {item.applicant.audience === "artist" ? "Artist" : "Community"}
                      {item.applicant.artistName ? ` · ${item.applicant.artistName}` : ""}
                      {item.applicant.city ? ` · ${item.applicant.city}` : ""}
                    </small>
                  </span>
                  <span className={styles.cell}>{formatDate(item.createdAt)}</span>
                  <span className={styles.cell}>
                    <span className={styles.score}>{percent(item.assessment.suitabilityScore)}</span>
                    {item.assessment.suitabilityBand ? <small title={BAND_LABEL[item.assessment.suitabilityBand]}>{BAND_SHORT[item.assessment.suitabilityBand]} band</small> : null}
                  </span>
                  <span className={styles.cell}>
                    {item.assessment.recommendation
                      ? <Badge size="sm" tone={RECOMMENDATION_TONE[item.assessment.recommendation]}>{RECOMMENDATION_LABEL[item.assessment.recommendation]}</Badge>
                      : <small>Not assessed</small>}
                  </span>
                  <span className={styles.cell}>
                    <Badge size="sm" tone={QUEUE_TONE[item.queue]}>{QUEUE_LABEL[item.queue]}</Badge>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {page && page.total > PAGE_SIZE ? (
            <div className={styles.pager}>
              <span>{filters.offset + 1}–{Math.min(filters.offset + PAGE_SIZE, page.total)} of {page.total}</span>
              <Button variant="secondary" size="sm" disabled={filters.offset === 0 || loading} onClick={() => update({ offset: Math.max(0, filters.offset - PAGE_SIZE) })}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={filters.offset + PAGE_SIZE >= page.total || loading} onClick={() => update({ offset: filters.offset + PAGE_SIZE })}>Next</Button>
            </div>
          ) : page ? <div className={styles.pager}><span>{page.total} {page.total === 1 ? "application" : "applications"}</span></div> : null}
        </section>

        <aside className={styles.panel} aria-label="Selected application">
          {!selected ? (
            <p className={styles.empty}>Select an application to review its evidence and record a decision.</p>
          ) : (
            <>
              <div className={styles.panelHeader}>
                <div>
                  <h2>{applicantLabel(selected)}</h2>
                  <p>
                    {selected.applicant.email ?? "No email"} · {selected.applicant.audience === "artist" ? "Artist application" : "Community application"} · submitted {formatDateTime(selected.createdAt)}
                  </p>
                </div>
                <Badge tone={QUEUE_TONE[selected.queue]}>{QUEUE_LABEL[selected.queue]}</Badge>
              </div>

              <dl className={styles.facts}>
                <div><dt>Suitability</dt><dd>{percent(selected.assessment.suitabilityScore)}{selected.assessment.suitabilityBand ? ` · ${BAND_LABEL[selected.assessment.suitabilityBand]}` : ""}</dd></div>
                <div><dt>Recommendation</dt><dd>{selected.assessment.recommendation ? RECOMMENDATION_LABEL[selected.assessment.recommendation] : "Not assessed yet"}</dd></div>
                <div><dt>Report confidence</dt><dd>{selected.assessment.confidence === null ? "—" : selected.assessment.confidence.toFixed(2)}</dd></div>
                <div><dt>Answers</dt><dd>{selected.assessment.answerCount}</dd></div>
              </dl>

              <section className={styles.decision} aria-label="Decision">
                {selected.decision ? (
                  <div className={styles.decided}>
                    <Badge tone={selected.decision.decision === "approved" ? "success" : "danger"}>
                      {selected.decision.decision === "approved" ? "Approved" : "Declined"}
                    </Badge>
                    <p>
                      {decisionAttribution(selected.decision)}
                      {" · "}{formatDateTime(selected.decision.decidedAt)}
                    </p>
                    {selected.decision.reason ? <blockquote>{selected.decision.reason}</blockquote> : null}
                    <small>Decisions are final once recorded. The applicant&apos;s next step is handled by your connected system.</small>
                  </div>
                ) : decidable && !canDecide ? (
                  <p className={styles.muted}>Only organisation owners and admins can record decisions. You can review the evidence here.</p>
                ) : decidable ? (
                  <div className={styles.decide}>
                    <label className={styles.reason}>
                      <span>Reason {pendingDecision === "declined" ? "(required)" : "(optional for approval)"}</span>
                      <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={1200} placeholder="What made the difference? This is kept with the decision." />
                    </label>
                    {pendingDecision ? (
                      <div ref={confirmGroup} className={styles.confirm} role="group" aria-label="Confirm decision">
                        <p>{pendingDecision === "approved" ? "Approve" : "Decline"} {applicantLabel(selected)}? This cannot be changed afterwards.</p>
                        <Button variant={pendingDecision === "approved" ? "primary" : "danger"} size="sm" loading={deciding} onClick={() => void confirmDecision()}>
                          Confirm {pendingDecision === "approved" ? "approval" : "decline"}
                        </Button>
                        <Button variant="ghost" size="sm" disabled={deciding} onClick={cancelDecision}>Cancel</Button>
                      </div>
                    ) : (
                      <div ref={decisionActions} className={styles.actions}>
                        <Button variant="primary" size="sm" onClick={() => startDecision("approved")}>Approve</Button>
                        <Button variant="secondary" size="sm" onClick={() => startDecision("declined")}>Decline</Button>
                      </div>
                    )}
                    {decisionError ? <p className={styles.decisionError} role="alert">{decisionError}</p> : null}
                  </div>
                ) : (
                  <p className={styles.muted}>
                    {selected.status === "active" ? "This application is still in progress." : selected.status === "abandoned" ? "The applicant left before finishing." : "Waiting for a decision."}
                  </p>
                )}
              </section>

              <div className={styles.tabs} role="tablist" aria-label="Application detail">
                {(["summary", "conversation", "applicant"] as const).map((tab) => (
                  <button key={tab} type="button" role="tab" aria-selected={view === tab} className={view === tab ? styles.tabActive : styles.tab} onClick={() => setView(tab)}>
                    {tab === "summary" ? "Assessment" : tab === "conversation" ? "Conversation" : "Applicant details"}
                  </button>
                ))}
              </div>

              <div className={styles.tabBody} role="tabpanel">
                {detailError ? <p className={styles.error} role="alert">{detailError}</p> : null}
                {view === "summary" ? (
                  <ReviewerReportView report={detail?.reviewerReport ?? null} sessionStatus={selected.status} loading={detailLoading} />
                ) : null}
                {view === "conversation" ? (
                  detailLoading ? <p className={styles.muted}>Loading conversation…</p> : (
                    <ol className={styles.transcript}>
                      {(detail?.messages ?? []).map((message) => (
                        <li key={message.id} className={message.role === "user" ? styles.applicantMessage : styles.grouchoMessage}>
                          <span>{message.role === "user" ? "Applicant" : "Groucho"}</span>
                          <p>{message.content}</p>
                        </li>
                      ))}
                    </ol>
                  )
                ) : null}
                {view === "applicant" ? (
                  <dl className={styles.facts}>
                    <div><dt>Name</dt><dd>{selected.applicant.name ?? "Not provided"}</dd></div>
                    <div><dt>Email</dt><dd>{selected.applicant.email ?? "Not provided"}</dd></div>
                    <div><dt>Type</dt><dd>{selected.applicant.audience === "artist" ? "Artist" : "Community"}</dd></div>
                    <div><dt>Artist name</dt><dd>{selected.applicant.artistName ?? "Not provided"}</dd></div>
                    <div><dt>City</dt><dd>{selected.applicant.city ?? "Not provided"}</dd></div>
                    <div><dt>Age</dt><dd>{selected.applicant.age ?? "Not provided"}</dd></div>
                    {([["Social links", selected.applicant.socialLinks], ["Music links", selected.applicant.musicLinks]] as const).map(([label, links]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{links.length ? links.map((link) => <a key={link} href={link} target="_blank" rel="noopener noreferrer" className={styles.link}>{link}</a>) : "None given"}</dd>
                      </div>
                    ))}
                    <div><dt>Reference</dt><dd>{selected.sessionKey}</dd></div>
                    <div><dt>Last activity</dt><dd>{formatDateTime(selected.updatedAt)}</dd></div>
                    <div><dt>Conversation model</dt><dd>{selected.assessment.conversationModel ?? "Not recorded"}</dd></div>
                  </dl>
                ) : null}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
