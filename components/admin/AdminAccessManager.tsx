"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/arc/button/button"
import styles from "./admin-access.module.css"

type AccessUser = {
  id: string
  email: string
  status: "active" | "pending" | "expired" | "revoked"
  protected: boolean
  source: string
  invited_by?: string
  expires_at?: string
  accepted_at?: string
}
type Payload = { currentEmail: string; users: AccessUser[] }
export default function AdminAccessManager() {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [email, setEmail] = useState("")
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState("all")
  const [busy, setBusy] = useState("")
  const [link, setLink] = useState<{ email: string; url: string } | null>(null)
  const [confirm, setConfirm] = useState<AccessUser | null>(null)
  const load = useCallback(async (signal?: AbortSignal) => {
    const res = await fetch("/api/admin/access", { signal, cache: "no-store" })
    const body = await res.json()
    if (!res.ok)
      throw new Error(body.error ?? "Admin access could not be loaded.")
    return body as Payload
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
      .then((body) => {
        if (!controller.signal.aborted) setData(body)
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [load])
  async function invite(address: string) {
    setBusy(address)
    setError("")
    setNotice("")
    setLink(null)
    try {
      const res = await fetch("/api/admin/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: address }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      setLink({ email: body.invitation.email, url: body.inviteUrl })
      setEmail("")
      setNotice(
        "Invitation created. Copy the link and share it with the invited person. No email has been sent.",
      )
      setData(await load())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invitation failed.")
    } finally {
      setBusy("")
    }
  }
  async function revoke(user: AccessUser) {
    setBusy(user.id)
    setError("")
    setNotice("")
    try {
      const res = await fetch(
        `/api/admin/access/${encodeURIComponent(user.id)}`,
        { method: "DELETE" },
      )
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      if (link?.email === user.email) setLink(null)
      setConfirm(null)
      setNotice(
        user.status === "active"
          ? "Platform admin access removed."
          : "Invitation cancelled.",
      )
      setData(await load())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove access.")
    } finally {
      setBusy("")
    }
  }
  const visible =
    data?.users.filter(
      (u) =>
        u.email.includes(query.toLowerCase().trim()) &&
        (filter === "all" || u.status === filter),
    ) ?? []
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Admin access</h1>
          <p>
            Choose who can manage Groucho across all organisations and projects.
          </p>
        </div>
      </header>
      {error && (
        <div role="alert" className={styles.message}>
          {error}{" "}
          {!data && (
            <Button
              variant="ghost"
              onClick={() => {
                setError("")
                load()
                  .then(setData)
                  .catch((e) => setError(e.message))
              }}
            >
              Try again
            </Button>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className={styles.message}>
          {notice}
        </p>
      )}
      <section className={styles.panel} aria-labelledby="invite-heading">
        <h2 id="invite-heading">Invite an administrator</h2>
        <p>
          They’ll sign in with this email and accept before receiving access.
          Invitations expire after seven days.
        </p>
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault()
            void invite(email)
          }}
        >
          <label>
            Email address
            <input
              type="email"
              placeholder="name@company.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={254}
              disabled={Boolean(busy)}
            />
          </label>
          <Button
            type="submit"
            loading={Boolean(busy && busy === email)}
            disabled={Boolean(busy) || !email.trim()}
          >
            Create invitation
          </Button>
        </form>
        {link && (
          <div className={styles.inviteLink}>
            <label>
              Share with {link.email}
              <input
                readOnly
                value={link.url}
                onFocus={(e) => e.target.select()}
              />
            </label>
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link.url)
                  setNotice("Invitation link copied.")
                } catch {
                  setNotice("Select the invitation link and copy it manually.")
                }
              }}
            >
              Copy link
            </Button>
            <p>Creating a replacement invalidates the previous link.</p>
          </div>
        )}
      </section>
      <section className={styles.panel} aria-labelledby="users-heading">
        <div className={styles.toolbar}>
          <h2 id="users-heading">People with dashboard access</h2>
          <div className={styles.controls}>
            <label className={styles.search}>
              <input
                aria-label="Search administrators"
                placeholder="Search email"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="Filter access status"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="pending">Invited</option>
              <option value="expired">Expired</option>
              <option value="revoked">Removed</option>
            </select>
          </div>
        </div>
        {!data ? (
          <p role="status">
            {error ? "Access list unavailable." : "Loading administrators…"}
          </p>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <caption className={styles.srOnly}>
                Dashboard platform administrators and invitations
              </caption>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Status</th>
                  <th>Access details</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.email}</strong>
                      {user.email === data.currentEmail && <small>You</small>}
                    </td>
                    <td>
                      <span className={styles.status}>
                        {
                          {
                            active: "Active",
                            pending: "Invited",
                            expired: "Expired",
                            revoked: "Removed",
                          }[user.status]
                        }
                      </span>
                    </td>
                    <td>
                      {user.protected
                        ? user.source
                        : user.status === "pending" || user.status === "expired"
                        ? `Expires ${new Date(
                            user.expires_at!,
                          ).toLocaleDateString()}`
                        : user.status === "active"
                        ? user.source === "Legacy operator"
                          ? "Legacy operator"
                          : "Platform administrator"
                        : "No platform access"}
                      {user.invited_by && (
                        <small>Invited by {user.invited_by}</small>
                      )}
                    </td>
                    <td>
                      {user.protected ? (
                        <span className={styles.muted}>Protected</span>
                      ) : user.email === data.currentEmail ? (
                        <span className={styles.muted}>Your account</span>
                      ) : confirm?.id === user.id ? (
                        <div className={styles.actions}>
                          <span>
                            {user.status === "active"
                              ? "Remove admin access?"
                              : "Cancel this invitation?"}
                          </span>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={Boolean(busy)}
                            onClick={() => revoke(user)}
                          >
                            Confirm
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={Boolean(busy)}
                            onClick={() => setConfirm(null)}
                          >
                            Keep
                          </Button>
                        </div>
                      ) : (
                        <div className={styles.actions}>
                          {user.status !== "active" && (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={Boolean(busy)}
                              onClick={() => invite(user.email)}
                            >
                              {user.status === "pending"
                                ? "Replace link"
                                : "Invite again"}
                            </Button>
                          )}
                          {["active", "pending"].includes(user.status) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={Boolean(busy)}
                              onClick={() => setConfirm(user)}
                            >
                              {user.status === "active"
                                ? "Remove access"
                                : "Cancel invite"}
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length && (
              <p className={styles.empty}>No people match this search.</p>
            )}
          </div>
        )}
        <p className={styles.footnote}>
          Core administrators are protected. Legacy operator access can be
          removed here. Removing platform access does not change a person’s
          organisation memberships.
        </p>
      </section>
    </div>
  )
}
