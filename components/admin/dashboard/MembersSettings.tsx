"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, type CSSProperties } from "react"
import { Check, MoreHorizontal, X } from "lucide-react"
import { useAdminWorkspace } from "@/components/admin/AdminWorkspace"
import type { OrgRole } from "@/lib/org-access"
import { useOrganisationSummary } from "./OrganisationSummaryContext"
import styles from "./dashboard.module.css"

type Member = {
  id: string
  user_id: string
  role: OrgRole
  invited_at: string | null
  accepted_at: string | null
  email: string | null
  is_you?: boolean
}

type Invitation = {
  id: string
  email: string
  role: OrgRole
  expires_at: string
  accepted_at: string | null
}

type Row =
  | { kind: "member"; id: string; email: string; role: OrgRole; since: string | null; you: boolean }
  | { kind: "invite"; id: string; email: string; role: OrgRole; expiresAt: string }

const COLUMNS = { "--columns": "minmax(0, 2.4fr) minmax(0, 1fr) minmax(0, 1.3fr) minmax(0, 1fr) 48px" } as CSSProperties
const ROLE_LABEL: Record<OrgRole, string> = { member: "Member", admin: "Admin", owner: "Owner" }
const ROLE_HELP: Record<OrgRole, string> = {
  member: "Reads applications, conversations and reports.",
  admin: "Also decides applications, manages projects and personas, invites people and renames the organisation.",
  owner: "Also changes roles, removes people, and can delete the organisation.",
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : fallback)
  return body as T
}

function shortDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "–"
}

function inviteStatus(expiresAt: string): { label: string; expired: boolean } {
  const days = Math.ceil((Date.parse(expiresAt) - Date.now()) / 86_400_000)
  if (days <= 0) return { label: "Invite expired", expired: true }
  return { label: `Invited · ${days} day${days === 1 ? "" : "s"} left`, expired: false }
}

function RowMenu({
  row,
  canManageMembers,
  canManageInvites,
  onRole,
  onRemove,
  onRevoke,
}: {
  row: Row
  canManageMembers: boolean
  canManageInvites: boolean
  onRole: (role: OrgRole) => void
  onRemove: () => void
  onRevoke: () => void
}) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !anchor.current?.contains(event.target as Node)) {
        setOpen(false)
        setConfirming(false)
      }
    }
    document.addEventListener("mousedown", close)
    document.addEventListener("keydown", close)
    return () => {
      document.removeEventListener("mousedown", close)
      document.removeEventListener("keydown", close)
    }
  }, [open])

  const allowed = row.kind === "member" ? canManageMembers && !row.you : canManageInvites
  if (!allowed) return <span />
  const done = (action: () => void) => {
    setOpen(false)
    setConfirming(false)
    action()
  }
  return (
    <div className={styles.menuAnchor} ref={anchor}>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={`Actions for ${row.email}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div className={styles.menu} role="menu">
          {row.kind === "member" ? (
            <>
              <span className={styles.menuLabel}>Role</span>
              {(["member", "admin", "owner"] as OrgRole[]).map((role) => (
                <button
                  key={role}
                  type="button"
                  role="menuitemradio"
                  aria-checked={row.role === role}
                  onClick={() => (row.role === role ? setOpen(false) : done(() => onRole(role)))}
                >
                  {ROLE_LABEL[role]}
                  {row.role === role ? <Check size={14} aria-hidden="true" /> : null}
                </button>
              ))}
              <hr />
              <button
                type="button"
                role="menuitem"
                className={styles.danger}
                onClick={() => (confirming ? done(onRemove) : setConfirming(true))}
              >
                {confirming ? "Click again to remove" : "Remove from organisation"}
              </button>
            </>
          ) : (
            <button type="button" role="menuitem" className={styles.danger} onClick={() => done(onRevoke)}>
              Revoke invitation
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}

function InviteDialog({
  orgId,
  orgName,
  open,
  canInviteOwner,
  onClose,
  onCreated,
}: {
  orgId: string
  orgName: string
  open: boolean
  canInviteOwner: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<OrgRole>("member")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<{ url: string; email: string } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])

  function reset() {
    setEmail("")
    setRole("member")
    setError(null)
    setLink(null)
    setCopied(false)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const created = await readJson<{ token?: string; email: string }>(
        await fetch(`/api/admin/organisations/${orgId}/invitations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, role }),
        }),
        "The invitation could not be created.",
      )
      setLink({ url: created.token ? `${window.location.origin}/invite/${created.token}` : "", email: created.email })
      onCreated()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The invitation could not be created.")
    } finally {
      setSaving(false)
    }
  }

  const roles: OrgRole[] = canInviteOwner ? ["member", "admin", "owner"] : ["member", "admin"]

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="invite-title"
      onClose={() => {
        reset()
        onClose()
      }}
    >
      <div className={styles.dialogBody}>
        <div className={styles.dialogHeader}>
          <div>
            <h2 id="invite-title">{link ? "Invite created" : `Invite people to ${orgName}`}</h2>
            <p>
              {link
                ? `Send this link to ${link.email}.`
                : canInviteOwner
                  ? "They get a link to join."
                  : "They get a link to join. Owners can only be invited by Groucho."}
            </p>
          </div>
          <button type="button" className={styles.iconButton} aria-label="Close" onClick={() => dialog.current?.close()}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {link ? (
          <>
            <div className={styles.copyField}>
              <code>{link.url}</code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(link.url).then(() => setCopied(true)).catch(() => setCopied(false))
                }}
              >
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <p className={styles.hint} style={{ margin: 0, lineHeight: 1.5 }}>
              This link is shown once and works for 14 days. They sign in with an email code when they open it.
            </p>
            <div className={styles.dialogActions}>
              <button type="button" className={styles.secondary} onClick={reset}>Invite someone else</button>
              <button type="button" className={styles.primary} onClick={() => dialog.current?.close()}>Done</button>
            </div>
          </>
        ) : (
          <form className={styles.dialogBody} onSubmit={submit}>
            <label className={styles.fieldStack}>
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus placeholder="colleague@company.com" style={{ maxWidth: "none" }} />
            </label>
            <fieldset style={{ margin: 0, padding: 0, border: 0, display: "grid", gap: 8 }}>
              <legend className={styles.hint} style={{ fontSize: 13, marginBottom: 6 }}>Role</legend>
              {roles.map((option) => (
                <label key={option} className={role === option ? styles.choiceActive : styles.choice}>
                  <input type="radio" name="invite-role" checked={role === option} onChange={() => setRole(option)} />
                  <span>
                    {ROLE_LABEL[option]}
                    <small>{ROLE_HELP[option]}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            <div className={styles.dialogActions}>
              <button type="button" className={styles.secondary} onClick={() => dialog.current?.close()}>Cancel</button>
              <button type="submit" className={styles.primary} disabled={saving}>{saving ? "Creating…" : "Create invite"}</button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  )
}

function GeneralTab({ orgId, canEdit, canDelete }: { orgId: string; canEdit: boolean; canDelete: boolean }) {
  const router = useRouter()
  const { summary, refresh } = useOrganisationSummary()
  const { retry } = useAdminWorkspace()
  const [name, setName] = useState(summary?.name ?? "")
  const [slug, setSlug] = useState(summary?.slug ?? "")
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null)
  const [confirm, setConfirm] = useState("")
  const [deleting, setDeleting] = useState(false)
  const dirty = name.trim() !== (summary?.name ?? "") || slug.trim() !== (summary?.slug ?? "")

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setNotice(null)
    try {
      await readJson(
        await fetch(`/api/admin/organisations/${orgId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), slug: slug.trim() }),
        }),
        "The organisation could not be saved.",
      )
      setNotice({ error: false, text: "Saved." })
      refresh()
      retry()
    } catch (problem) {
      setNotice({ error: true, text: problem instanceof Error ? problem.message : "The organisation could not be saved." })
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setDeleting(true)
    setNotice(null)
    try {
      await readJson(
        await fetch(`/api/admin/organisations/${orgId}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmSlug: confirm.trim() }),
        }),
        "The organisation could not be deleted.",
      )
      router.push("/admin")
    } catch (problem) {
      setNotice({ error: true, text: problem instanceof Error ? problem.message : "The organisation could not be deleted." })
      setDeleting(false)
    }
  }

  return (
    <>
      <form className={styles.card} onSubmit={save} aria-labelledby="org-details">
        <div className={styles.cardBody}>
          <div>
            <h2 id="org-details" className={styles.sectionTitle}>Organisation</h2>
            <p className={styles.subtitle} style={{ marginTop: 4 }}>How {summary?.name ?? "this organisation"} appears across Groucho.</p>
          </div>
          <label className={styles.fieldStack}>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} disabled={!canEdit} required maxLength={120} />
          </label>
          <label className={styles.fieldStack}>
            Slug
            <input className={styles.mono} value={slug} onChange={(event) => setSlug(event.target.value)} disabled={!canEdit} required maxLength={60} />
            <span className={styles.hint}>Used to name personas cloned into this organisation. Lowercase letters, numbers and hyphens.</span>
          </label>
          {notice ? <p className={notice.error ? styles.error : styles.notice} role={notice.error ? "alert" : "status"}>{notice.text}</p> : null}
        </div>
        <div className={styles.cardFooter}>
          <span>{canEdit ? "Owners and admins can change these." : "Only owners and admins can change these."}</span>
          {canEdit ? <button type="submit" className={styles.primary} disabled={!dirty || saving}>{saving ? "Saving…" : "Save"}</button> : null}
        </div>
      </form>

      {canDelete ? (
        <section className={styles.dangerCard} aria-labelledby="danger">
          <div className={styles.cardBody}>
            <div>
              <h2 id="danger" className={styles.sectionTitle}>Delete {summary?.name}</h2>
              <p className={styles.subtitle} style={{ marginTop: 4, lineHeight: 1.5 }}>
                Removes the organisation with its projects, conversations, decisions and personas. This can&apos;t be undone.
              </p>
            </div>
            <label className={styles.fieldStack}>
              <span>Type <span className={styles.mono} style={{ color: "var(--foreground)" }}>{summary?.slug}</span> to confirm</span>
              <input className={styles.mono} value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="off" />
            </label>
            <div>
              <button
                type="button"
                className={styles.dangerButton}
                disabled={!summary?.slug || confirm.trim() !== summary.slug || deleting}
                onClick={() => void remove()}
              >
                {deleting ? "Deleting…" : "Delete organisation"}
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </>
  )
}

export function MembersSettings() {
  const { orgId, summary } = useOrganisationSummary()
  const [tab, setTab] = useState<"members" | "general">("members")
  const [token, setToken] = useState(0)
  const [data, setData] = useState<{ key: string; members?: Member[]; invitations?: Invitation[]; error?: string } | null>(null)
  const [inviting, setInviting] = useState(false)
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null)
  const key = `${orgId}|${token}`

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    Promise.all([
      fetch(`/api/admin/organisations/${orgId}/members`, { cache: "no-store" }).then((response) => readJson<Member[]>(response, "Members could not be loaded.")),
      fetch(`/api/admin/organisations/${orgId}/invitations`, { cache: "no-store" }).then((response) => readJson<Invitation[]>(response, "Invitations could not be loaded.")),
    ])
      .then(([members, invitations]) => {
        if (!cancelled) setData({ key, members, invitations })
      })
      .catch((error: Error) => {
        if (!cancelled) setData({ key, error: error.message })
      })
    return () => {
      cancelled = true
    }
  }, [orgId, key])

  const role = summary?.role ?? null
  const isPlatform = role === "platform"
  const canManageMembers = role === "owner" || isPlatform
  const canManageInvites = Boolean(summary?.canManage)

  const rows: Row[] = [
    ...(data?.members ?? []).map((member) => ({
      kind: "member" as const,
      id: member.id,
      email: member.email ?? "Unknown email",
      role: member.role,
      since: member.accepted_at ?? member.invited_at,
      you: Boolean(member.is_you),
    })),
    ...(data?.invitations ?? [])
      .filter((invitation) => !invitation.accepted_at)
      .map((invitation) => ({ kind: "invite" as const, id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expires_at })),
  ]

  async function act(action: () => Promise<Response>, success: string, fallback: string) {
    setNotice(null)
    try {
      await readJson(await action(), fallback)
      setNotice({ error: false, text: success })
      setToken((value) => value + 1)
    } catch (problem) {
      setNotice({ error: true, text: problem instanceof Error ? problem.message : fallback })
    }
  }

  const memberCount = data?.members?.length ?? summary?.memberCount ?? 0

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Members &amp; settings</h1>
          <p className={styles.subtitle}>Who can open {summary?.name ?? "this organisation"} in Groucho, and what they can do.</p>
        </div>
        {canManageInvites && tab === "members" ? (
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => setInviting(true)}>Invite people</button>
          </div>
        ) : null}
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Settings">
        <button type="button" role="tab" aria-selected={tab === "members"} className={tab === "members" ? styles.tabActive : styles.tab} onClick={() => setTab("members")}>
          Members <span className={styles.count}>{memberCount}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "general"} className={tab === "general" ? styles.tabActive : styles.tab} onClick={() => setTab("general")}>
          General
        </button>
      </div>

      {tab === "members" ? (
        <>
          {notice ? <p className={notice.error ? styles.error : styles.notice} role={notice.error ? "alert" : "status"}>{notice.text}</p> : null}
          {data?.error ? <p className={styles.error} role="alert">{data.error}</p> : null}
          {!data ? <div className={styles.skeleton} /> : null}
          {data && !data.error ? (
            rows.length ? (
              // Visible overflow so a row's menu can extend past the table; the columns shrink instead of scrolling.
              <div className={styles.table} style={{ overflow: "visible" }}>
                <div className={styles.tableInner} style={{ minWidth: 0 }}>
                  <div className={styles.head} style={COLUMNS}>
                    <span>Person</span>
                    <span>Role</span>
                    <span>Status</span>
                    <span>Joined</span>
                    <span />
                  </div>
                  {rows.map((row) => {
                    const pending = row.kind === "invite" ? inviteStatus(row.expiresAt) : null
                    return (
                      <div key={`${row.kind}-${row.id}`} className={styles.row} style={{ ...COLUMNS, minHeight: 52 }}>
                        <span className={styles.person}>
                          <span className={row.kind === "invite" ? styles.avatarPending : styles.avatar} aria-hidden="true">
                            {row.email.charAt(0).toUpperCase()}
                          </span>
                          <span>
                            <span className={styles.secondaryText} style={{ color: row.kind === "invite" ? "var(--text-secondary)" : "var(--foreground)" }}>{row.email}</span>
                            {row.kind === "member" && row.you ? <small>You</small> : null}
                          </span>
                        </span>
                        <span className={row.kind === "invite" ? styles.secondaryText : undefined}>{ROLE_LABEL[row.role]}</span>
                        <span className={styles.status}>
                          <span className={row.kind === "member" ? styles.dotLive : pending?.expired ? styles.dotEnded : styles.dotIdle} aria-hidden="true" />
                          {row.kind === "member" ? "Active" : pending?.label}
                        </span>
                        <span className={styles.secondaryText}>{row.kind === "member" ? shortDate(row.since) : "–"}</span>
                        <RowMenu
                          row={row}
                          canManageMembers={canManageMembers}
                          canManageInvites={canManageInvites}
                          onRole={(newRole) =>
                            void act(
                              () => fetch(`/api/admin/organisations/${orgId}/members/${row.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ role: newRole }),
                              }),
                              `${row.email} is now ${ROLE_LABEL[newRole].toLowerCase()}.`,
                              "The role could not be changed.",
                            )
                          }
                          onRemove={() =>
                            void act(
                              () => fetch(`/api/admin/organisations/${orgId}/members/${row.id}`, { method: "DELETE" }),
                              `${row.email} was removed.`,
                              "They could not be removed.",
                            )
                          }
                          onRevoke={() =>
                            void act(
                              () => fetch(`/api/admin/organisations/${orgId}/invitations/${row.id}`, { method: "DELETE" }),
                              `The invitation to ${row.email} was revoked.`,
                              "The invitation could not be revoked.",
                            )
                          }
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <p className={styles.empty}>Nobody has joined yet. Invite people to give them access.</p>
            )
          ) : null}

          <section className={styles.section} aria-labelledby="role-help">
            <h2 id="role-help" className={styles.sectionTitle}>What each role can do</h2>
            <dl className={styles.roles}>
              {(["member", "admin", "owner"] as OrgRole[]).map((option) => (
                <div key={option} style={{ display: "contents" }}>
                  <dt>{ROLE_LABEL[option]}</dt>
                  <dd>{ROLE_HELP[option]}</dd>
                </div>
              ))}
            </dl>
          </section>
        </>
      ) : orgId && summary ? (
        <GeneralTab key={`${summary.name}|${summary.slug}`} orgId={orgId} canEdit={summary.canManage} canDelete={role === "owner" || isPlatform} />
      ) : (
        <div className={styles.skeleton} />
      )}

      {orgId ? (
        <InviteDialog
          orgId={orgId}
          orgName={summary?.name ?? "this organisation"}
          open={inviting}
          canInviteOwner={isPlatform}
          onClose={() => setInviting(false)}
          onCreated={() => setToken((value) => value + 1)}
        />
      ) : null}
    </div>
  )
}
