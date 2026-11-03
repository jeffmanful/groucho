"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import type { NeedsYouDelivery } from "@/lib/needs-you"
import { durationSince } from "@/lib/relative-time"
import dashboard from "../dashboard/dashboard.module.css"
import styles from "./client.module.css"

type Delivery = Omit<NeedsYouDelivery, "projectName">

function useDeliveryFailures(orgId: string, projectId: string, token: number) {
  const [state, setState] = useState<{ key: string; deliveries?: Delivery[]; error?: string } | null>(null)
  const key = `${orgId}:${projectId}:${token}`
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/admin/organisations/${orgId}/projects/${projectId}/delivery-failures`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error ?? "Delivery failures could not be loaded.")
        if (!controller.signal.aborted) setState({ key, deliveries: body.deliveries ?? [] })
      })
      .catch((error: Error) => { if (!controller.signal.aborted) setState({ key, error: error.message }) })
    return () => controller.abort()
  }, [orgId, projectId, key])
  return state?.key === key ? state : null
}

export function DeliveryFailureAlert({ orgId, projectId, token = 0 }: { orgId: string; projectId: string; token?: number }) {
  const state = useDeliveryFailures(orgId, projectId, token)
  if (!state?.deliveries?.length) return null
  return <p className={dashboard.notice} role="status">Some application updates could not be delivered to your system. <Link className={dashboard.link} href={`/admin/organisations/${orgId}/integrations?project=${projectId}#delivery-failures`}>Check integrations</Link></p>
}

export function DeliveryFailures({ orgId, projectId, canManage }: { orgId: string; projectId: string; canManage: boolean }) {
  const [token, setToken] = useState(0)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const state = useDeliveryFailures(orgId, projectId, token)

  async function retry(id: string) {
    setRetrying(id)
    setNotice(null)
    try {
      const response = await fetch(`/api/admin/organisations/${orgId}/webhook-deliveries/${id}/retry`, { method: "POST" })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? "The delivery could not be retried.")
      setNotice(body.status === "delivered" ? "Delivered." : "Still not delivered. Check your endpoint and try again.")
      setToken((value) => value + 1)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The delivery could not be retried.")
    } finally { setRetrying(null) }
  }

  return (
    <section id="delivery-failures" className={dashboard.section} aria-labelledby="delivery-failures-title">
      <div>
        <h2 id="delivery-failures-title" className={dashboard.sectionTitle}>Recent delivery failures</h2>
        <p className={dashboard.subtitle}>Up to 20 failed deliveries from the last 30 days, newest first. These updates may be missing from your system.</p>
      </div>
      {notice ? <p className={dashboard.notice} role="status">{notice}</p> : null}
      {state?.error ? <p className={dashboard.error} role="alert">{state.error}</p> : null}
      {!state ? <p className={styles.muted} role="status">Loading deliveries…</p> : null}
      {state?.deliveries?.length === 0 ? <p className={styles.muted}>No failed deliveries in the last 30 days.</p> : null}
      {state?.deliveries?.length ? <div className={styles.panel}>
        {state.deliveries.map((delivery) => <div className={styles.item} key={delivery.id}>
          <span className={styles.who}>{delivery.applicant?.name ?? delivery.applicant?.email ?? "Applicant"}</span>
          <span className={`${styles.secondary} ${styles.truncate}`} title={delivery.lastError ?? undefined}>{delivery.url} · {delivery.attempts} attempts{delivery.httpStatus ? ` · HTTP ${delivery.httpStatus}` : ""}</span>
          <span className={styles.muted}>{durationSince(delivery.createdAt)} ago</span>
          {canManage ? <button className={styles.button} disabled={retrying !== null} onClick={() => void retry(delivery.id)}>{retrying === delivery.id ? "Sending…" : "Retry delivery"}</button> : null}
        </div>)}
      </div> : null}
    </section>
  )
}
