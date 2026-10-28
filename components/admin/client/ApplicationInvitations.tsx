"use client"

import { useEffect, useState } from "react"
import styles from "../dashboard/dashboard.module.css"

type Invitation = { id: string; email: string; name: string | null; audience: string; expires_at: string; revoked_at: string | null }
export function ApplicationInvitations({ orgId, projectId, canManage }: { orgId: string; projectId: string; canManage: boolean }) {
  const [enabled, setEnabled] = useState(false)
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [audience, setAudience] = useState("community")
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState(0)
  const base = `/api/admin/organisations/${orgId}/projects/${projectId}/application-invitations`
  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    void fetch(base, { cache: "no-store" }).then(async response => {
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "Invitations could not be loaded.")
      if (!cancelled) { setEnabled(body.enabled === true); setInvitations(body.invitations) }
    }).catch(problem => { if (!cancelled) setError(problem instanceof Error ? problem.message : "Invitations unavailable.") })
    return () => { cancelled = true }
  }, [base, orgId, token])

  async function mutate(method: "POST" | "DELETE", body: unknown) {
    setBusy(true); setError(null)
    try {
      const response = await fetch(base, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "The invitation could not be saved.")
      if (result.url) { setLink(result.url); setCopied(false); setEmail(""); setName("") }
      setToken(current => current + 1)
    } catch (problem) { setError(problem instanceof Error ? problem.message : "The invitation could not be saved.") }
    finally { setBusy(false) }
  }
  if (!enabled && !error) return null
  return (
    <section className={styles.section} aria-labelledby="application-invitations">
      <div><h2 id="application-invitations" className={styles.sectionTitle}>Application invitations</h2>
        <p className={styles.subtitle}>Invite someone to one application conversation. This does not grant Forum access. Links expire after seven days; your team shares them.</p></div>
      {canManage ? <form className={styles.form} onSubmit={event => { event.preventDefault(); void mutate("POST", { email, name, audience }) }}>
        <label className={styles.field}>Email<input type="email" required maxLength={320} value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label className={styles.field}>Name (optional)<input maxLength={160} value={name} onChange={event => setName(event.target.value)} /></label>
        <label className={styles.field}>Application<select value={audience} onChange={event => setAudience(event.target.value)}><option value="community">Community</option><option value="artist">Artist</option></select></label>
        <button type="submit" className={styles.primary} disabled={busy}>{busy ? "Saving…" : "Create invitation link"}</button>
      </form> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {link ? <div className={styles.card}><div className={styles.cardBody} style={{ gap: 12 }}>
        <p className={styles.subtitle}>Copy this private application link before leaving. Groucho has not emailed it.</p>
        <div className={styles.copyField}><code>{link}</code><button type="button" onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true)).catch(() => setError("Copy the displayed link manually."))}>{copied ? "Copied" : "Copy link"}</button></div>
        <button type="button" className={styles.secondary} onClick={() => setLink(null)}>I have saved the link</button>
      </div></div> : null}
      {invitations.length ? <div className={styles.card}><div className={styles.cardBody} style={{ gap: 16 }}>{invitations.map(invitation => <div key={invitation.id} style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between" }}>
        <span>{invitation.email}<small className={styles.secondaryText} style={{ display: "block" }}>{invitation.audience} · {invitation.revoked_at ? "Revoked" : `Expires ${new Date(invitation.expires_at).toLocaleDateString()}`}</small></span>
        {canManage && !invitation.revoked_at ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => void mutate("DELETE", { id: invitation.id })}>Revoke invitation</button> : null}
      </div>)}</div></div> : <p className={styles.subtitle}>No application invitations yet.</p>}
    </section>
  )
}
