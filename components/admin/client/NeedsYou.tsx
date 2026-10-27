"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useOrganisationSummary } from "@/components/admin/dashboard/OrganisationSummaryContext"
import dashboard from "@/components/admin/dashboard/dashboard.module.css"
import type { NeedsYou as NeedsYouData } from "@/lib/needs-you"
import { durationSince } from "@/lib/relative-time"
import styles from "./client.module.css"

const RECOMMENDATION_LABEL = { recommend: "Recommended", human_review: "Review", decline: "Below threshold" } as const

function eventLabel(event: string): string {
  if (event === "application.decided") return "Decision"
  if (event === "application.decision_corrected") return "Correction"
  return "Finished application"
}

export function NeedsYou() {
  const { orgId, summary, refresh } = useOrganisationSummary()
  const [token, setToken] = useState(0)
  const [state, setState] = useState<{ key: string; data?: NeedsYouData; error?: string } | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null)
  const key = `${orgId}|${token}`

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    fetch(`/api/admin/organisations/${orgId}/needs-you`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "This list could not be loaded.")
        if (!cancelled) setState({ key, data: body as NeedsYouData })
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ key, error: error.message })
      })
    return () => {
      cancelled = true
    }
  }, [orgId, key])

  const data = state?.key === key ? state.data : state?.data
  const base = `/admin/organisations/${orgId}`
  const canManage = Boolean(summary?.canManage)
  const multipleProjects = new Set(data?.readyToDecide.map((item) => item.projectId) ?? []).size > 1

  async function retry(deliveryId: string) {
    setRetrying(deliveryId)
    setNotice(null)
    try {
      const response = await fetch(`/api/admin/organisations/${orgId}/webhook-deliveries/${deliveryId}/retry`, { method: "POST" })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The delivery could not be retried.")
      setNotice(
        body.status === "delivered"
          ? { error: false, text: "Delivered." }
          : { error: true, text: `Still not delivered${body.httpStatus ? ` (HTTP ${body.httpStatus})` : ""}. Check your endpoint and try again.` },
      )
      setToken((value) => value + 1)
      refresh?.()
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : "The delivery could not be retried." })
    } finally {
      setRetrying(null)
    }
  }

  return (
    <div className={dashboard.page}>
      <header className={dashboard.header}>
        <h1 className={dashboard.title}>Needs you</h1>
      </header>

      {notice ? <p className={notice.error ? dashboard.error : dashboard.notice} role="status">{notice.text}</p> : null}
      {state?.error ? <p className={dashboard.error} role="alert">{state.error}</p> : null}
      {!data && !state?.error ? <div className={dashboard.skeleton} style={{ height: 180 }} aria-label="Loading" /> : null}

      {data && data.total === 0 ? (
        <div className={styles.panel} style={{ padding: 24 }}>
          <p style={{ margin: 0 }}>Nothing needs you right now.</p>
          <p className={styles.muted} style={{ margin: "6px 0 0" }}>
            {data.awaitingAssessment
              ? `${data.awaitingAssessment} finished ${data.awaitingAssessment === 1 ? "application is" : "applications are"} waiting for Groucho's assessment.`
              : "New applications appear here once Groucho has assessed them."}
          </p>
        </div>
      ) : null}

      {data && data.readyToDecide.length ? (
        <section className={dashboard.section} aria-labelledby="ready">
          <div className={dashboard.sectionHeader}>
            <h2 id="ready" className={styles.groupTitle}>
              Ready to decide <span className={styles.mono} style={{ color: "var(--text-muted)" }}>{data.readyToDecideTotal}</span>
            </h2>
            <Link className={dashboard.link} href={`${base}/applications`}>Open queue</Link>
          </div>
          <div className={styles.panel}>
            {data.readyToDecide.map((item) => {
              const label = item.recommendation ? RECOMMENDATION_LABEL[item.recommendation] : "Assessed"
              return (
                <div key={item.id} className={styles.item}>
                  <span className={styles.who}>
                    <span className={`${styles.dot} ${item.recommendation === "recommend" ? styles.dotSuccess : styles.dotWarning}`} aria-hidden="true" />
                    <span>{item.name ?? item.email ?? "Applicant"}</span>
                  </span>
                  <span className={`${styles.secondary} ${styles.truncate}`}>
                    {label}
                    {item.suitabilityScore !== null ? ` · ${item.suitabilityScore.toFixed(2)}` : ""}
                    {item.audience === "artist" ? " · artist" : ""}
                    {multipleProjects ? ` · ${item.projectName}` : ""}
                  </span>
                  <span className={styles.muted}>Waiting {durationSince(item.waitingSince)}</span>
                  <Link className={styles.button} href={`${base}/applications/${item.projectId}/${item.id}`}>
                    Decide
                  </Link>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {data && data.failedDeliveries.length ? (
        <section className={dashboard.section} aria-labelledby="undelivered">
          <div>
            <h2 id="undelivered" className={styles.groupTitle}>
              Not delivered to your system <span className={styles.mono} style={{ color: "var(--text-muted)" }}>{data.failedDeliveries.length}</span>
            </h2>
            <p className={dashboard.subtitle} style={{ marginTop: 4 }}>
              Your system didn&apos;t accept these events, so it may not know about these applicants.
            </p>
          </div>
          <div className={styles.panel}>
            {data.failedDeliveries.map((delivery) => (
              <div key={delivery.id} className={styles.item}>
                <span className={styles.who}>
                  <span className={`${styles.dot} ${styles.dotDanger}`} aria-hidden="true" />
                  <span>
                    {delivery.applicant?.name ?? delivery.applicant?.email ?? "Applicant"}
                    {delivery.decision ? <span className={styles.muted}> · {delivery.decision}</span> : null}
                  </span>
                </span>
                <span className={`${styles.secondary} ${styles.truncate}`} title={delivery.lastError ?? undefined}>
                  {eventLabel(delivery.event)} to {hostOf(delivery.url)} · {delivery.attempts} {delivery.attempts === 1 ? "attempt" : "attempts"}
                  {delivery.httpStatus ? `, HTTP ${delivery.httpStatus}` : ""}
                </span>
                <span className={styles.muted}>{durationSince(delivery.createdAt)} ago</span>
                {canManage ? (
                  <button type="button" className={styles.button} disabled={retrying === delivery.id} onClick={() => void retry(delivery.id)}>
                    {retrying === delivery.id ? "Sending…" : "Retry now"}
                  </button>
                ) : <span />}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
