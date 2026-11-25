"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import type { DemoVariant } from "@/lib/project-demo-links"
import { useOrganisationSummary } from "./OrganisationSummaryContext"
import styles from "./dashboard.module.css"
import demoStyles from "./project-demo-links.module.css"

type DemoLink = { id: string; recipient_email: string | null; variant: DemoVariant; expires_at: string; sent_at: string | null; path: string }
type DemoLinks = { variants: DemoVariant[]; links: DemoLink[] }

const variants: Record<DemoVariant, string> = {
  conversation: "Project conversation",
  community: "Community application",
  artist: "Artist application",
}

async function readDemoResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? "Demo links are unavailable. Try again.")
  return body as T
}

export function ProjectDemoLinks({ projectId }: { projectId: string }) {
  const { orgId, summary } = useOrganisationSummary()
  const project = summary?.projects.find(item => item.id === projectId)
  const endpoint = `/api/admin/organisations/${orgId}/projects/${projectId}/demo-links`
  const canManage = Boolean(summary?.canManage && project)
  const [data, setData] = useState<DemoLinks | null>(null)
  const [email, setEmail] = useState("")
  const [selected, setSelected] = useState<DemoVariant | "">("")
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [reload, setReload] = useState(0)
  const [confirm, setConfirm] = useState<string | null>(null)
  const inFlight = useRef(false)
  const selectedVariant = selected || data?.variants[0]

  useEffect(() => {
    if (!canManage) return
    const controller = new AbortController()
    void fetch(endpoint, { signal: controller.signal })
      .then(readDemoResponse<DemoLinks>)
      .then(result => { if (!controller.signal.aborted) setData(result) })
      .catch(problem => { if (!controller.signal.aborted) setError(problem.message) })
    return () => controller.abort()
  }, [canManage, endpoint, reload])

  function mutate<T>(body: Record<string, unknown>) {
    return fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(readDemoResponse<T>)
  }

  async function act(id: string, action: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(id)
    setError("")
    setNotice("")
    try {
      await action()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Try again.")
    } finally {
      setBusy("")
      inFlight.current = false
    }
  }

  async function send(link: DemoLink) {
    const { sentAt } = await mutate<{ sentAt: string }>({ action: "send", id: link.id })
    setData(current => current && { ...current, links: current.links.map(item =>
      item.id === link.id ? { ...item, sent_at: sentAt } : item) })
    setNotice(`Invitation sent to ${link.recipient_email}.`)
  }

  async function create(invite: boolean) {
    const { link } = await mutate<{ link: DemoLink }>({
      action: "create", variant: selectedVariant, email: invite ? email : undefined,
    })
    setData(current => current && { ...current, links: [link, ...current.links] })
    if (invite) {
      setEmail("")
      await send(link)
    } else {
      setNotice("Demo link created.")
    }
  }

  async function copy(link: DemoLink) {
    await navigator.clipboard.writeText(new URL(link.path, window.location.origin).href)
    setNotice("Demo link copied.")
  }

  return <div className={styles.page}>
    <Link className={styles.link} href={`/admin/organisations/${orgId}/projects`}>← Projects</Link>
    <header className={styles.header}>
      <div>
        <h1 className={styles.title}>Project demo</h1>
        {project && <p className={styles.subtitle}>{project.name}</p>}
      </div>
    </header>
    {summary && !canManage && <p className={styles.empty}>Ask an organisation admin for a demo link.</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {canManage && !data && (error
      ? <button className={styles.secondary} type="button" onClick={() => { setError(""); setReload(value => value + 1) }}>Try again</button>
      : <p role="status">Loading demo links…</p>)}
    {data && <>
      {selectedVariant ? <section className={styles.section} aria-labelledby="share-demo">
        <h2 id="share-demo" className={styles.sectionTitle}>Share the demo</h2>
        <p className={styles.subtitle}>Anyone with the link can try this walkthrough for 14 days.</p>
        <form className={`${styles.form} ${demoStyles.form}`} onSubmit={event => {
          event.preventDefault()
          if (email.trim()) void act("create", () => create(true))
        }}>
          {data.variants.length > 1 && <label className={styles.field}>
            Walkthrough
            <select value={selectedVariant} onChange={event => setSelected(event.target.value as DemoVariant)} disabled={!!busy}>
              {data.variants.map(variant => <option key={variant} value={variant}>{variants[variant]}</option>)}
            </select>
          </label>}
          <label className={styles.field}>
            Invite by email
            <input type="email" maxLength={254} placeholder="name@example.com" value={email} onChange={event => setEmail(event.target.value)} disabled={!!busy} />
          </label>
          <div className={demoStyles.actions}>
            <button type="submit" className={styles.primary} disabled={!!busy || !email.trim()}>Send invitation</button>
            <button type="button" className={styles.secondary} disabled={!!busy} onClick={() => void act("create", () => create(false))}>Create share link</button>
          </div>
        </form>
      </section> : <p className={styles.empty}>This project has no shareable walkthrough.</p>}
      <section className={styles.section} aria-labelledby="active-demo-links">
        <h2 id="active-demo-links" className={styles.sectionTitle}>Active links</h2>
        {data.links.length === 0 ? <p className={styles.empty}>No active demo links.</p> :
          <ul className={demoStyles.links}>{data.links.map(link => <li key={link.id} className={demoStyles.link}>
            <div>
              <strong>{link.recipient_email ?? "Share link"}</strong>
              <p className={styles.subtitle}>{variants[link.variant]} · Expires {new Intl.DateTimeFormat("en-GB", {
                dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London",
              }).format(new Date(link.expires_at))}{link.sent_at && " · Invitation sent"}</p>
            </div>
            <div className={demoStyles.actions}>
              {confirm === link.id ? <>
                <button className={styles.dangerButton} type="button" disabled={!!busy} onClick={() => void act(link.id, async () => {
                  await mutate({ action: "revoke", id: link.id })
                  setData(current => current && { ...current, links: current.links.filter(item => item.id !== link.id) })
                  setConfirm(null)
                  setNotice("Demo link revoked.")
                })}>Revoke link</button>
                <button className={styles.secondary} type="button" disabled={!!busy} onClick={() => setConfirm(null)}>Cancel</button>
              </> : <>
                <a className={styles.secondary} href={link.path} target="_blank" rel="noreferrer">Open demo</a>
                <button className={styles.secondary} type="button" disabled={!!busy} onClick={() => void act(link.id, () => copy(link))}>Copy link</button>
                {link.recipient_email && !link.sent_at && <button className={styles.secondary} type="button" disabled={!!busy} onClick={() => void act(link.id, () => send(link))}>Send email</button>}
                <button className={styles.secondary} type="button" disabled={!!busy} onClick={() => setConfirm(link.id)}>Revoke</button>
              </>}
            </div>
          </li>)}</ul>}
      </section>
    </>}
  </div>
}
