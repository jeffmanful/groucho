"use client"

import Link from "next/link"
import { useEffect, useState, type CSSProperties } from "react"
import { ArrowLeft } from "lucide-react"
import { projectStatus } from "./OrgOverview"
import { useOrganisationSummary } from "./OrganisationSummaryContext"
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_LABELS, type WebhookEvent } from "@/lib/webhook-events"
import styles from "./dashboard.module.css"

type ApiKey = { id: string; key_prefix: string; label: string | null; scopes?: string[]; last_used_at: string | null; created_at: string; revoked_at: string | null }
type KeyUse = "conversations" | "applications"

const KEY_USES: Array<{ value: KeyUse; name: string; description: string }> = [
  { value: "conversations", name: "Conversations", description: "Starts and runs applicant conversations. Safe behind your site's proxy." },
  { value: "applications", name: "Applications", description: "Lists applications and records decisions. Keep it on your server only." },
]
type Webhook = { id: string; label: string | null; url: string; events: string[]; active: boolean; created_at: string }

const KEY_COLUMNS = { "--columns": "minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 0.9fr) minmax(0, 0.9fr) 120px" } as CSSProperties
const HOOK_COLUMNS = { "--columns": "minmax(0, 2.2fr) minmax(0, 0.9fr) minmax(0, 1.6fr) minmax(0, 0.8fr) 200px" } as CSSProperties
const SHORT_EVENT_NAMES: Record<WebhookEvent, string> = {
  "session.completed": "Finished",
  "application.decided": "Decided",
  "application.decision_corrected": "Corrected",
  "application.allocated": "Placed",
  "cohort.locked": "Locked",
  "cohort.drawn": "Drawn",
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : fallback)
  return body as T
}

function date(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Never"
}

function Secret({ label, value, onDismiss }: { label: string; value: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className={styles.card} style={{ maxWidth: "none" }} role="status">
      <div className={styles.cardBody} style={{ gap: 10 }}>
        <strong style={{ fontWeight: 500 }}>{label}</strong>
        <div className={styles.copyField}>
          <code>{value}</code>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(value).then(() => setCopied(true)).catch(() => setCopied(false))}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <span className={styles.hint}>It won&apos;t be shown again. Store it somewhere safe before you leave this page.</span>
        <div>
          <button type="button" className={styles.secondary} onClick={onDismiss}>I&apos;ve saved it</button>
        </div>
      </div>
    </div>
  )
}

export function ProjectIntegrations({ projectId }: { projectId: string }) {
  const { orgId, summary } = useOrganisationSummary()
  const [token, setToken] = useState(0)
  const [data, setData] = useState<{ key: string; keys?: ApiKey[]; hooks?: Webhook[]; error?: string } | null>(null)
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null)
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null)
  const [keyLabel, setKeyLabel] = useState("")
  const [keyUse, setKeyUse] = useState<KeyUse>("conversations")
  const [hookEvents, setHookEvents] = useState<WebhookEvent[]>([...WEBHOOK_EVENTS])
  const [addingKey, setAddingKey] = useState(false)
  const [hookUrl, setHookUrl] = useState("")
  const [hookLabel, setHookLabel] = useState("")
  const [addingHook, setAddingHook] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const base = `/api/admin/organisations/${orgId}/projects/${projectId}`
  const key = `${orgId}|${projectId}|${token}`

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    Promise.all([
      fetch(`/api/admin/organisations/${orgId}/projects/${projectId}/api-keys`, { cache: "no-store" }).then((response) => readJson<ApiKey[] | { keys?: ApiKey[] }>(response, "API keys could not be loaded.")),
      fetch(`/api/admin/organisations/${orgId}/projects/${projectId}/webhooks`, { cache: "no-store" }).then((response) => readJson<Webhook[] | { webhooks?: Webhook[] }>(response, "Webhooks could not be loaded.")),
    ])
      .then(([keys, hooks]) => {
        if (cancelled) return
        setData({
          key,
          keys: Array.isArray(keys) ? keys : keys.keys ?? [],
          hooks: Array.isArray(hooks) ? hooks : hooks.webhooks ?? [],
        })
      })
      .catch((error: Error) => {
        if (!cancelled) setData({ key, error: error.message })
      })
    return () => {
      cancelled = true
    }
  }, [orgId, projectId, key])

  const project = summary?.projects.find((candidate) => candidate.id === projectId) ?? null
  const canManage = Boolean(summary?.canManage)
  const status = project ? projectStatus(project) : null
  const orgBase = `/admin/organisations/${orgId}`

  async function run(id: string, action: () => Promise<void>, fallback: string) {
    setBusy(id)
    setNotice(null)
    try {
      await action()
      setToken((value) => value + 1)
    } catch (problem) {
      setNotice({ error: true, text: problem instanceof Error ? problem.message : fallback })
    } finally {
      setBusy(null)
      setConfirming(null)
    }
  }

  const activeKeys = (data?.keys ?? []).filter((apiKey) => !apiKey.revoked_at)

  return (
    <div className={styles.page}>
      <Link href={`${orgBase}/projects`} className={styles.link} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: -16 }}>
        <ArrowLeft size={14} aria-hidden="true" /> Projects
      </Link>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{project?.name ?? "Project"}</h1>
          {project && status ? (
            <p className={styles.subtitle} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className={status.dot} aria-hidden="true" />
              {status.label}{project.personaName ? ` · ${project.personaName}` : ""}
            </p>
          ) : null}
        </div>
      </header>

      <nav className={styles.tabs} aria-label="Project">
        <Link className={styles.tab} href={`${orgBase}/projects/${projectId}/edit`}>Setup</Link>
        <span className={styles.tabActive} aria-current="page">Keys &amp; webhooks</span>
        <Link className={styles.tab} href={`/admin/sessions?project=${projectId}`}>Conversations</Link>
        <Link className={styles.tab} href={`${orgBase}/advanced?project=${projectId}`}>Advanced</Link>
      </nav>

      {notice ? <p className={notice.error ? styles.error : styles.notice} role="alert">{notice.text}</p> : null}
      {data?.error ? <p className={styles.error} role="alert">{data.error}</p> : null}
      {secret ? <Secret label={secret.label} value={secret.value} onDismiss={() => setSecret(null)} /> : null}

      <section className={styles.section} aria-labelledby="api-keys">
        <div className={styles.sectionHeader} style={{ alignItems: "flex-end" }}>
          <div>
            <h2 id="api-keys" className={styles.sectionTitle}>API keys</h2>
            <p className={styles.subtitle} style={{ marginTop: 4 }}>Let your site run conversations, or your server review applications. A new key is shown once.</p>
          </div>
        </div>
        {canManage ? (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault()
              void run("key:new", async () => {
                const created = await readJson<{ secret?: string; key?: string }>(
                  await fetch(`${base}/api-keys`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ label: keyLabel, scopes: [keyUse] }),
                  }),
                  "The key could not be created.",
                )
                const value = created.secret ?? created.key
                if (value) setSecret({ label: keyUse === "applications" ? "Your new applications key — use it from your server only" : "Your new API key", value })
                setKeyLabel("")
                setKeyUse("conversations")
                setAddingKey(false)
              }, "The key could not be created.")
            }}
            hidden={!addingKey}
          >
            <fieldset className={styles.choiceGroup}>
              <legend>Use</legend>
              {KEY_USES.map((use) => (
                <label key={use.value} className={keyUse === use.value ? styles.choiceActive : styles.choice}>
                  <input type="radio" name="key-use" value={use.value} checked={keyUse === use.value} onChange={() => setKeyUse(use.value)} />
                  <span>
                    {use.name}
                    <small>{use.description}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <label className={styles.field}>
              Name
              <input value={keyLabel} onChange={(event) => setKeyLabel(event.target.value)} placeholder="Where it's used, e.g. Forum site" maxLength={80} />
            </label>
            <button type="submit" className={styles.primary} disabled={busy === "key:new"}>{busy === "key:new" ? "Creating…" : "Create key"}</button>
            <button type="button" className={styles.secondary} onClick={() => setAddingKey(false)}>Cancel</button>
          </form>
        ) : null}
        <div className={styles.table}>
          <div className={styles.tableInner} style={{ minWidth: 820 }}>
            <div className={styles.head} style={KEY_COLUMNS}>
              <span>Name</span>
              <span>Use</span>
              <span>Key</span>
              <span>Created</span>
              <span>Last used</span>
              <span style={{ textAlign: "right" }}>
                {canManage && !addingKey ? <button type="button" className={styles.rowAction} onClick={() => setAddingKey(true)}>Create key</button> : null}
              </span>
            </div>
            {activeKeys.map((apiKey) => (
              <div key={apiKey.id} className={styles.row} style={KEY_COLUMNS}>
                <span className={styles.name}>{apiKey.label ?? "Unnamed key"}</span>
                <span className={styles.secondaryText}>{apiKey.scopes?.includes("applications") ? "Applications" : "Conversations"}</span>
                <span className={`${styles.mono} ${styles.secondaryText}`}>{apiKey.key_prefix}••••</span>
                <span className={styles.secondaryText}>{date(apiKey.created_at)}</span>
                <span className={styles.secondaryText}>{date(apiKey.last_used_at)}</span>
                <span className={styles.rowActions}>
                  {canManage ? (
                    <button
                      type="button"
                      className={styles.rowAction}
                      style={confirming === apiKey.id ? { color: "var(--danger)" } : undefined}
                      disabled={busy === apiKey.id}
                      onClick={() =>
                        confirming === apiKey.id
                          ? void run(apiKey.id, async () => {
                              await readJson(
                                await fetch(`${base}/api-keys/${apiKey.id}`, {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ revoked: true }),
                                }),
                                "The key could not be revoked.",
                              )
                            }, "The key could not be revoked.")
                          : setConfirming(apiKey.id)
                      }
                    >
                      {confirming === apiKey.id ? "Confirm revoke" : "Revoke"}
                    </button>
                  ) : null}
                </span>
              </div>
            ))}
            {data && !data.error && !activeKeys.length ? <p className={styles.row} style={{ color: "var(--text-muted)", margin: 0 }}>No active keys.</p> : null}
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="webhooks">
        <div>
          <h2 id="webhooks" className={styles.sectionTitle}>Webhooks</h2>
          <p className={styles.subtitle} style={{ marginTop: 4 }}>Groucho sends a signed message to these addresses when an application finishes or is decided.</p>
        </div>
        {canManage ? (
          <form
            className={styles.form}
            hidden={!addingHook}
            onSubmit={(event) => {
              event.preventDefault()
              void run("hook:new", async () => {
                const created = await readJson<{ signing_secret?: string }>(
                  await fetch(`${base}/webhooks`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ url: hookUrl, label: hookLabel || null, events: hookEvents }),
                  }),
                  "The webhook could not be added.",
                )
                if (created.signing_secret) setSecret({ label: "Signing secret for your webhook", value: created.signing_secret })
                setHookUrl("")
                setHookLabel("")
                setHookEvents([...WEBHOOK_EVENTS])
                setAddingHook(false)
              }, "The webhook could not be added.")
            }}
          >
            <label className={styles.field} style={{ flex: "1 1 320px" }}>
              HTTPS address
              <input type="url" value={hookUrl} onChange={(event) => setHookUrl(event.target.value)} required placeholder="https://" style={{ width: "100%" }} />
            </label>
            <label className={styles.field}>
              Label
              <input value={hookLabel} onChange={(event) => setHookLabel(event.target.value)} maxLength={80} />
            </label>
            <fieldset className={styles.choiceGroup}>
              <legend>Send when</legend>
              {WEBHOOK_EVENTS.map((event) => {
                const checked = hookEvents.includes(event)
                return (
                  <label key={event} className={checked ? styles.choiceActive : styles.choice}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={checked && hookEvents.length === 1}
                      onChange={() => setHookEvents((current) => checked ? current.filter((value) => value !== event) : WEBHOOK_EVENTS.filter((value) => value === event || current.includes(value)))}
                    />
                    <span>
                      {WEBHOOK_EVENT_LABELS[event].name}
                      <small>{WEBHOOK_EVENT_LABELS[event].description} <span className={styles.mono}>{event}</span></small>
                    </span>
                  </label>
                )
              })}
            </fieldset>
            <button type="submit" className={styles.primary} disabled={busy === "hook:new"}>{busy === "hook:new" ? "Adding…" : "Add webhook"}</button>
            <button type="button" className={styles.secondary} onClick={() => setAddingHook(false)}>Cancel</button>
          </form>
        ) : null}
        <div className={styles.table}>
          <div className={styles.tableInner} style={{ minWidth: 880 }}>
            <div className={styles.head} style={HOOK_COLUMNS}>
              <span>Address</span>
              <span>Label</span>
              <span>Sends</span>
              <span>Status</span>
              <span style={{ textAlign: "right" }}>
                {canManage && !addingHook ? <button type="button" className={styles.rowAction} onClick={() => setAddingHook(true)}>Add webhook</button> : null}
              </span>
            </div>
            {(data?.hooks ?? []).map((hook) => (
              <div key={hook.id} className={styles.row} style={HOOK_COLUMNS}>
                <span className={`${styles.mono} ${styles.secondaryText}`} style={{ color: "var(--foreground)" }}>{hook.url}</span>
                <span className={styles.secondaryText}>{hook.label ?? "–"}</span>
                <span className={styles.eventToggles}>
                  {WEBHOOK_EVENTS.map((event) => {
                    // An empty list means every event, as it always has.
                    const on = !hook.events?.length || hook.events.includes(event)
                    const onlyOne = on && (hook.events?.length ?? 0) === 1
                    return canManage ? (
                      <label key={event} className={styles.eventToggle} title={WEBHOOK_EVENT_LABELS[event].description}>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={onlyOne || busy === `events:${hook.id}`}
                          onChange={() =>
                            void run(`events:${hook.id}`, async () => {
                              const current = hook.events?.length ? hook.events : [...WEBHOOK_EVENTS]
                              const events = WEBHOOK_EVENTS.filter((value) => (value === event ? !on : current.includes(value)))
                              await readJson(
                                await fetch(`${base}/webhooks/${hook.id}`, {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ events }),
                                }),
                                "The webhook could not be updated.",
                              )
                            }, "The webhook could not be updated.")
                          }
                        />
                        {SHORT_EVENT_NAMES[event]}
                      </label>
                    ) : on ? (
                      <span key={event} className={styles.secondaryText}>{SHORT_EVENT_NAMES[event]}</span>
                    ) : null
                  })}
                </span>
                <span className={styles.status}>
                  <span className={hook.active ? styles.dotLive : styles.dotIdle} aria-hidden="true" />
                  {hook.active ? "Active" : "Paused"}
                </span>
                <span className={styles.rowActions}>
                  {canManage ? (
                    <>
                      <button
                        type="button"
                        className={styles.rowAction}
                        disabled={busy === `test:${hook.id}`}
                        onClick={() =>
                          void run(`test:${hook.id}`, async () => {
                            const result = await readJson<{ ok?: boolean; http_status?: number; error?: string }>(
                              await fetch(`${base}/webhooks/${hook.id}/test`, { method: "POST" }),
                              "The test could not be sent.",
                            )
                            setNotice({
                              error: result.ok === false,
                              text: result.ok === false
                                ? `Test failed${result.http_status ? ` (HTTP ${result.http_status})` : ""}${result.error ? `: ${result.error}` : ""}.`
                                : `Test delivered${result.http_status ? ` (HTTP ${result.http_status})` : ""}.`,
                            })
                          }, "The test could not be sent.")
                        }
                      >
                        {busy === `test:${hook.id}` ? "Sending…" : "Send test"}
                      </button>
                      <button
                        type="button"
                        className={styles.rowAction}
                        style={confirming === hook.id ? { color: "var(--danger)" } : undefined}
                        disabled={busy === hook.id}
                        onClick={() =>
                          confirming === hook.id
                            ? void run(hook.id, async () => {
                                await readJson(await fetch(`${base}/webhooks/${hook.id}`, { method: "DELETE" }), "The webhook could not be removed.")
                              }, "The webhook could not be removed.")
                            : setConfirming(hook.id)
                        }
                      >
                        {confirming === hook.id ? "Confirm remove" : "Remove"}
                      </button>
                    </>
                  ) : null}
                </span>
              </div>
            ))}
            {data && !data.error && !(data.hooks ?? []).length ? <p className={styles.row} style={{ color: "var(--text-muted)", margin: 0 }}>No webhooks yet.</p> : null}
          </div>
        </div>
      </section>
    </div>
  )
}
