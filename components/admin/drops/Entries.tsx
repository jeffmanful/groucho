"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import dashboard from "@/components/admin/dashboard/dashboard.module.css"
import client from "@/components/admin/client/client.module.css"
import type { EntriesPage, EntryFlag, EntryItem, EntryTab, MatchGroup } from "@/lib/entry-review"
import { shortDate } from "@/lib/relative-time"
import { AddToCohortDialog } from "./AddToCohortDialog"
import styles from "./drops.module.css"
import { fieldLabel, nf, ProjectSwitch, useDropProject } from "./useDropProject"

const PAGE = 50
const TABS: Array<{ value: EntryTab; label: string; stat: keyof EntriesPage["stats"] }> = [
  { value: "review", label: "To review", stat: "review" },
  { value: "flagged", label: "Flagged", stat: "flagged" },
  { value: "approved", label: "Approved", stat: "approved" },
  { value: "declined", label: "Declined", stat: "declined" },
]

function flagText(flag: EntryFlag): string {
  if (flag.kind === "disposable") return "Disposable email"
  const what = flag.kind === "email" ? "Same email" : flag.kind === "phone" ? "Same phone" : "Same social"
  return `${what} ×${flag.count}`
}

function conversationText(entry: EntryItem): string {
  if (entry.conversation.finished) return `Finished · ${entry.conversation.answers} answers`
  if (entry.conversation.answers) return `${entry.conversation.answers} answers`
  return entry.kind === "form" ? "Skipped" : "Not finished"
}

function socialsText(entry: EntryItem): string {
  if (!entry.socials.length) return "No socials"
  const first = entry.socials[0].replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")
  return entry.socials.length > 1 ? `${first} · ${entry.socials.length - 1} more` : first
}

async function send(url: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "That didn't work. Try again.")
  return data
}

export function Entries() {
  const { orgId, projects, project, choose, canManage, summary } = useDropProject()
  const [tab, setTab] = useState<EntryTab>("review")
  const [noFlags, setNoFlags] = useState(false)
  const [field, setField] = useState<string | null>(null)
  const [value, setValue] = useState<string>("")
  const [conversation, setConversation] = useState<"any" | "finished" | "none">("any")
  const [search, setSearch] = useState("")
  const [query, setQuery] = useState("")
  const [offset, setOffset] = useState(0)
  const [reload, setReload] = useState(0)
  const [state, setState] = useState<{ key: string; data?: EntriesPage; error?: string } | null>(null)
  // The selection belongs to one list: changing project or filters starts a fresh one.
  const [selection, setSelection] = useState<{ list: string; ids: Set<string>; all: boolean }>({ list: "", ids: new Set(), all: false })
  const [focused, setFocused] = useState<string | null>(null)
  const [declining, setDeclining] = useState(false)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const projectId = project?.id ?? null
  const filterParams = useMemo(() => {
    const params = new URLSearchParams({ tab })
    if (noFlags && tab !== "flagged") params.set("noFlags", "1")
    if (field && value) {
      params.set("field", field)
      params.set("value", value)
    }
    if (conversation !== "any") params.set("conversation", conversation)
    if (query) params.set("q", query)
    return params.toString()
  }, [tab, noFlags, field, value, conversation, query])
  const key = `${projectId}|${filterParams}|${offset}|${reload}`

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim())
      setOffset(0)
    }, 250)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (!orgId || !projectId) return
    let cancelled = false
    fetch(`/api/admin/organisations/${orgId}/projects/${projectId}/entries?${filterParams}&offset=${offset}&limit=${PAGE}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Entries could not be loaded.")
        if (!cancelled) setState({ key, data: body as EntriesPage })
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ key, error: error.message })
      })
    return () => {
      cancelled = true
    }
  }, [orgId, projectId, filterParams, offset, key])

  const listKey = `${projectId}|${filterParams}`
  const selected = selection.list === listKey ? selection.ids : new Set<string>()
  const allMatching = selection.list === listKey && selection.all
  const setSelected = (ids: Set<string> | ((current: Set<string>) => Set<string>)) =>
    setSelection((current) => {
      const before = current.list === listKey ? current.ids : new Set<string>()
      return { list: listKey, ids: typeof ids === "function" ? ids(before) : ids, all: false }
    })
  const setAllMatching = (all: boolean) =>
    setSelection((current) => ({ list: listKey, ids: current.list === listKey ? current.ids : new Set(), all }))

  const data = state?.key === key ? state.data : state?.data
  const loading = state?.key !== key
  const entries = useMemo(() => data?.entries ?? [], [data])
  const fieldKeys = Object.keys(data?.fields ?? {})
  const shownField = fieldKeys.includes("size") ? "size" : fieldKeys[0] ?? null
  const flaggedTab = tab === "flagged"
  const focusedEntry = flaggedTab ? entries.find((entry) => entry.id === focused) ?? entries[0] ?? null : null
  const total = data?.total ?? 0
  const selectedCount = allMatching ? total : selected.size
  const pageAllSelected = entries.length > 0 && entries.every((entry) => selected.has(entry.id))
  const flaggedInSelection = allMatching ? 0 : entries.filter((entry) => selected.has(entry.id) && entry.flags.length).length
  const approveCount = allMatching && !noFlags ? null : selectedCount - flaggedInSelection
  const base = orgId && projectId ? `/api/admin/organisations/${orgId}/projects/${projectId}` : ""

  const refresh = useCallback(() => setReload((n) => n + 1), [])

  function toggle(id: string) {
    setAllMatching(false)
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function decide(decision: "approved" | "declined", reason = "", applicantReason = "") {
    if (!base) return
    setBusy(true)
    setActionError(null)
    try {
      const target = allMatching ? { filters: filterParams } : { sessionIds: [...selected] }
      const result = await send(`${base}/entries/decisions`, { decision, reason, applicantReason, ...target })
      const recorded = Number(result.recorded ?? 0)
      const skipped = Number(result.skipped ?? 0)
      setNotice(`${decision === "approved" ? "Approved" : "Declined"} ${nf.format(recorded)}${skipped ? `. ${nf.format(skipped)} already had a decision.` : "."}`)
      setDeclining(false)
      setSelected(new Set())
      setAllMatching(false)
      refresh()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "That didn't work.")
    } finally {
      setBusy(false)
    }
  }

  const columns = {
    "--columns": flaggedTab
      ? `minmax(0,1.5fr) ${shownField ? "64px " : ""}minmax(0,1.2fr) minmax(0,1.1fr) 76px`
      : `28px minmax(0,1.6fr) ${shownField ? "64px " : ""}minmax(0,1.2fr) minmax(0,1fr) minmax(0,1.3fr) 76px`,
  } as CSSProperties

  if (summary && !project) {
    return (
      <div className={dashboard.page}>
        <h1 className={dashboard.title}>Entries</h1>
        <p className={client.muted}>Create a project to start taking entries.</p>
      </div>
    )
  }

  const table = (
    <div className={`${client.panel} ${styles.table}`} aria-busy={loading}>
      <div className={styles.tableInner}>
        <div className={`${styles.row} ${styles.rowHead}`} style={columns}>
          {flaggedTab ? null : (
            <input
              type="checkbox"
              className={styles.check}
              aria-label="Select this page"
              checked={allMatching || pageAllSelected}
              ref={(input) => {
                if (input) input.indeterminate = !allMatching && !pageAllSelected && selected.size > 0
              }}
              onChange={() => {
                setAllMatching(false)
                setSelected(pageAllSelected || allMatching ? new Set() : new Set(entries.map((entry) => entry.id)))
              }}
              disabled={!canManage || tab === "declined"}
            />
          )}
          <span>Person</span>
          {shownField ? <span>{fieldLabel(shownField)}</span> : null}
          <span>Socials</span>
          <span>{flaggedTab ? "Flag" : tab === "approved" ? "Cohort" : "Flags"}</span>
          {flaggedTab ? null : <span>Conversation</span>}
          <span>Entered</span>
        </div>
        {entries.map((entry) => {
          const isFocused = flaggedTab && focusedEntry?.id === entry.id
          const name = entry.name ?? entry.email ?? "Entrant"
          const cells = (
            <>
              <span className={client.person}>
                {flaggedTab ? (
                  <span className={client.truncate}>{name}</span>
                ) : (
                  <Link className={client.truncate} href={`/admin/organisations/${orgId}/applications/${projectId}/${entry.id}`} style={{ color: "inherit", textDecoration: "none" }}>
                    {name}
                  </Link>
                )}
                {entry.name && entry.email ? <span className={`${client.muted} ${client.small} ${client.truncate}`}>{entry.email}</span> : null}
              </span>
              {shownField ? <span className={`${client.mono} ${client.secondary}`}>{entry.fields[shownField] ?? "–"}</span> : null}
              <span className={`${client.secondary} ${client.truncate}`}>{socialsText(entry)}</span>
              {tab === "approved" ? (
                <span className={entry.cohort ? client.secondary : client.muted}>{entry.cohort?.name ?? "Not placed"}</span>
              ) : (
                <span className={styles.flags}>
                  {entry.flags.length
                    ? entry.flags.map((flag) => (
                        <span key={flag.kind} className={`${styles.flag} ${flag.kind === "disposable" ? styles.flagBad : ""}`}>
                          {flagText(flag)}
                        </span>
                      ))
                    : <span className={client.muted}>–</span>}
                </span>
              )}
              {flaggedTab ? null : <span className={client.secondary}>{conversationText(entry)}</span>}
              <span className={client.muted}>{shortDate(entry.createdAt)}</span>
            </>
          )
          if (flaggedTab) {
            return (
              <div
                key={entry.id}
                role="button"
                tabIndex={0}
                aria-pressed={isFocused}
                className={`${styles.row} ${styles.rowButton} ${isFocused ? styles.rowSelected : ""}`}
                style={columns}
                onClick={() => setFocused(entry.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    setFocused(entry.id)
                  }
                }}
              >
                {cells}
              </div>
            )
          }
          return (
            <div key={entry.id} className={`${styles.row} ${selected.has(entry.id) || allMatching ? styles.rowSelected : ""}`} style={columns}>
              <input
                type="checkbox"
                className={styles.check}
                aria-label={`Select ${name}`}
                checked={allMatching || selected.has(entry.id)}
                onChange={() => toggle(entry.id)}
                disabled={!canManage || tab === "declined"}
              />
              {cells}
            </div>
          )
        })}
        {data && !entries.length ? (
          <p className={client.muted} style={{ margin: 0, padding: "18px 16px" }}>
            {flaggedTab ? "Nothing is flagged." : query || field || noFlags || conversation !== "any" ? "No entries match." : "No entries here yet."}
          </p>
        ) : null}
      </div>
    </div>
  )

  return (
    <div className={dashboard.page} style={{ maxWidth: 1440 }}>
      <header className={styles.head}>
        <h1 className={dashboard.title}>Entries</h1>
        <span className={client.muted}>/</span>
        <ProjectSwitch projects={projects} value={projectId ?? ""} onChange={choose} />
        <span className={styles.headActions}>
          <Link className={client.button} href={`/admin/organisations/${orgId}/cohorts${projectId ? `?project=${projectId}` : ""}`}>
            Cohorts
          </Link>
        </span>
      </header>

      {data ? (
        <div className={`${client.panel} ${styles.stats}`}>
          <div>
            <span className={client.secondary}>Entered</span>
            <span className={styles.statValue}>{nf.format(data.stats.entered)}</span>
          </div>
          <div>
            <span className={client.secondary}>To review</span>
            <span className={styles.statValue}>{nf.format(data.stats.review)}</span>
          </div>
          <div>
            <span className={client.secondary}>Flagged</span>
            <span className={`${styles.statValue} ${data.stats.flagged ? styles.warnValue : ""}`}>{nf.format(data.stats.flagged)}</span>
          </div>
          <div>
            <span className={client.secondary}>Approved</span>
            <span className={styles.statValue}>{nf.format(data.stats.approved)}</span>
          </div>
          <div>
            <span className={client.secondary}>Declined</span>
            <span className={styles.statValue}>{nf.format(data.stats.declined)}</span>
          </div>
        </div>
      ) : null}

      <div className={styles.filters}>
        <div className={client.segment} role="group" aria-label="Show">
          {TABS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={tab === option.value}
              onClick={() => {
                setTab(option.value)
                setOffset(0)
                setFocused(null)
                setNotice(null)
              }}
            >
              {option.label}
              {data && (option.value === "review" || option.value === "flagged") && data.stats[option.stat] ? (
                <span className={client.mono} style={{ marginLeft: 6 }}>{nf.format(data.stats[option.stat])}</span>
              ) : null}
            </button>
          ))}
        </div>
        {flaggedTab ? null : (
          <button type="button" className={`${styles.chip} ${noFlags ? "" : styles.chipOff}`} aria-pressed={noFlags} onClick={() => setNoFlags((v) => !v)}>
            No flags{noFlags ? <span className={client.muted} aria-hidden="true">×</span> : null}
          </button>
        )}
        {fieldKeys.length ? (
          <span className={`${styles.chip} ${field && value ? "" : styles.chipOff}`}>
            <select
              aria-label="Filter by field"
              value={field && value ? `${field}=${value}` : ""}
              onChange={(event) => {
                const [k, ...v] = event.target.value.split("=")
                setField(k || null)
                setValue(v.join("="))
                setOffset(0)
              }}
            >
              <option value="">{fieldLabel(shownField ?? fieldKeys[0])}</option>
              {fieldKeys.map((key) => (
                <optgroup key={key} label={fieldLabel(key)}>
                  {(data?.fields[key] ?? []).map((option) => (
                    <option key={option} value={`${key}=${option}`}>
                      {fieldLabel(key)} is {option}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </span>
        ) : null}
        <span className={`${styles.chip} ${conversation === "any" ? styles.chipOff : ""}`}>
          <select aria-label="Conversation" value={conversation} onChange={(event) => setConversation(event.target.value as typeof conversation)}>
            <option value="any">Conversation</option>
            <option value="finished">Finished a conversation</option>
            <option value="none">No conversation</option>
          </select>
        </span>
        <input className={client.search} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search entries" aria-label="Search entries" />
      </div>

      {state?.error ? <p className={dashboard.error} role="alert">{state.error}</p> : null}
      {notice ? <p className={client.secondary} role="status" style={{ margin: 0 }}>{notice}</p> : null}
      {actionError && !declining ? <p className={dashboard.error} role="alert">{actionError}</p> : null}

      {!flaggedTab && selectedCount > 0 && canManage ? (
        <div className={`${client.panel} ${styles.selectionBar}`}>
          <span>
            <span style={{ fontWeight: 500 }}>{allMatching ? `All ${nf.format(total)}` : nf.format(selectedCount)}</span>{" "}
            <span className={client.secondary}>{allMatching ? "matching entries selected" : "selected"}</span>
          </span>
          {allMatching ? (
            <button type="button" className={styles.linkButton} onClick={() => setAllMatching(false)}>
              Select only this page
            </button>
          ) : pageAllSelected && total > entries.length ? (
            <button type="button" className={styles.linkButton} onClick={() => setAllMatching(true)}>
              Select all {nf.format(total)} matching
            </button>
          ) : null}
          <span>
            {tab === "review" ? (
              <>
                <button type="button" className={client.button} disabled={busy} onClick={() => setDeclining(true)}>
                  Decline…
                </button>
                <button type="button" className={client.buttonPrimary} disabled={busy || approveCount === 0} onClick={() => void decide("approved")}>
                  {busy ? "Saving…" : approveCount === null ? "Approve all without flags" : `Approve ${nf.format(approveCount)}`}
                </button>
              </>
            ) : null}
            {tab === "approved" && !allMatching ? (
              <button type="button" className={client.buttonPrimary} onClick={() => setAdding(true)}>
                Add {nf.format(selectedCount)} to a cohort
              </button>
            ) : null}
            {tab === "approved" && allMatching ? (
              <Link className={client.button} href={`/admin/organisations/${orgId}/cohorts?project=${projectId}`}>
                Place everyone from Cohorts
              </Link>
            ) : null}
          </span>
        </div>
      ) : null}

      {flaggedTab && focusedEntry ? (
        <div className={styles.split}>
          {table}
          <FlagPanel
            key={focusedEntry.id}
            base={base}
            entry={focusedEntry}
            canManage={canManage}
            onDone={(message) => {
              setNotice(message)
              setFocused(null)
              refresh()
            }}
          />
        </div>
      ) : (
        table
      )}

      {data && total > PAGE ? (
        <div className={styles.footer}>
          <span className={client.muted}>
            Showing {nf.format(offset + 1)}–{nf.format(Math.min(offset + PAGE, total))} of {nf.format(total)}
          </span>
          <span>
            {tab === "review" ? <span className={client.muted}>Flagged entries are never included in a bulk approve.</span> : null}
            <button type="button" className={client.button} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              Previous
            </button>
            <button type="button" className={client.button} disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
              Next
            </button>
          </span>
        </div>
      ) : tab === "review" && entries.length ? (
        <p className={client.muted} style={{ margin: 0 }}>Flagged entries are never included in a bulk approve.</p>
      ) : null}

      {declining ? (
        <DeclineDialog
          count={selectedCount}
          busy={busy}
          error={actionError}
          onClose={() => {
            setDeclining(false)
            setActionError(null)
          }}
          onDecline={(reason, applicantReason) => void decide("declined", reason, applicantReason)}
        />
      ) : null}

      {adding && orgId && projectId ? (
        <AddToCohortDialog
          orgId={orgId}
          projectId={projectId}
          source="any"
          sessionIds={[...selected]}
          onClose={() => setAdding(false)}
          onDone={(message) => {
            setAdding(false)
            setNotice(message)
            setSelected(new Set())
            refresh()
          }}
        />
      ) : null}
    </div>
  )
}

function DeclineDialog({
  count,
  busy,
  error,
  onClose,
  onDecline,
}: {
  count: number
  busy: boolean
  error: string | null
  onClose: () => void
  onDecline: (reason: string, applicantReason: string) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [reason, setReason] = useState("")
  const [applicantReason, setApplicantReason] = useState("")
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog ref={ref} className={dashboard.dialog} style={{ width: "min(520px, calc(100vw - 32px))" }} onClose={onClose} aria-labelledby="decline-title">
      <form
        className={dashboard.dialogBody}
        onSubmit={(event) => {
          event.preventDefault()
          onDecline(reason, applicantReason)
        }}
      >
        <div className={dashboard.dialogHeader}>
          <div>
            <h2 id="decline-title">Decline {nf.format(count)} {count === 1 ? "entry" : "entries"}</h2>
            <p>Each person gets the same reason in their history. Your system is told through application.decided.</p>
          </div>
        </div>
        <label className={client.field}>
          Reason
          <textarea className={client.textarea} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1200} required autoFocus />
        </label>
        <label className={client.field}>
          <span>
            Reason you can share with them <span className={client.muted}>· optional</span>
          </span>
          <textarea className={client.textarea} value={applicantReason} onChange={(event) => setApplicantReason(event.target.value)} maxLength={1200} />
        </label>
        {error ? <p className={client.errorText} role="alert">{error}</p> : null}
        <div className={dashboard.dialogActions}>
          <button type="button" className={client.button} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={client.buttonPrimary} disabled={busy || !reason.trim()}>
            {busy ? "Saving…" : `Decline ${nf.format(count)}`}
          </button>
        </div>
      </form>
    </dialog>
  )
}

function decisionText(entry: EntryItem): string | null {
  if (!entry.decision) return null
  return entry.decision.decision === "approved" ? "Approved" : "Declined"
}

/** One flagged entry and everything it matches: keep one and decline the rest, decline all, or not duplicates. */
function FlagPanel({ base, entry, canManage, onDone }: { base: string; entry: EntryItem; canManage: boolean; onDone: (message: string) => void }) {
  const [groups, setGroups] = useState<MatchGroup[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [groupIndex, setGroupIndex] = useState(0)
  const [keep, setKeep] = useState<string>(entry.id)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${base}/entries/${entry.id}/matches`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Matches could not be loaded.")
        if (!cancelled) setGroups((body.groups ?? []) as MatchGroup[])
      })
      .catch((problem: Error) => {
        if (!cancelled) setLoadError(problem.message)
      })
    return () => {
      cancelled = true
    }
  }, [base, entry.id])

  const group = groups?.[groupIndex] ?? null
  const undecided = (group?.entries ?? []).filter((item) => !item.decision)
  const keepEntry = group?.entries.find((item) => item.id === keep) ?? null
  const others = undecided.filter((item) => item.id !== keep)
  const disposable = group?.kind === "disposable"

  async function run(action: "keep" | "all" | "dismiss") {
    if (!group) return
    setBusy(true)
    setError(null)
    try {
      if (action === "dismiss") {
        await send(`${base}/entries/matches/dismiss`, { token: group.token, reason })
        onDone(disposable ? "That email provider won't be flagged again in this project." : "Marked as not duplicates.")
        return
      }
      const ids = action === "all" ? undecided.map((item) => item.id) : others.map((item) => item.id)
      const fallback = disposable ? "Disposable email address" : "Duplicate entry"
      const result = await send(`${base}/entries/decisions`, { decision: "declined", sessionIds: ids, reason: reason.trim() || fallback })
      onDone(`Declined ${nf.format(Number(result.recorded ?? ids.length))} as ${disposable ? "disposable" : "duplicates"}.`)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "That didn't work.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className={`${client.panel} ${styles.sidePanel}`} aria-label="Resolve flag">
      {loadError ? (
        <div>
          <p className={client.errorText} role="alert">{loadError}</p>
        </div>
      ) : !groups ? (
        <div>
          <span className={client.muted}>Loading matches…</span>
        </div>
      ) : !group ? (
        <div>
          <h2>Nothing left to resolve</h2>
          <span className={client.secondary}>This entry no longer matches anyone. It goes back to To review.</span>
        </div>
      ) : (
        <>
          <div>
            <h2>{disposable ? "Disposable email address" : `${group.label.split(":")[0]} on ${group.entries.length} entries`}</h2>
            <span className={client.secondary}>{group.label.split(": ").slice(1).join(": ")}</span>
            {groups.length > 1 ? (
              <div className={styles.inline}>
                {groups.map((g, index) => (
                  <button
                    key={g.token}
                    type="button"
                    className={`${styles.chip} ${index === groupIndex ? "" : styles.chipOff}`}
                    aria-pressed={index === groupIndex}
                    onClick={() => {
                      setGroupIndex(index)
                      setKeep(entry.id)
                    }}
                  >
                    {g.label.split(":")[0]}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div>
            {disposable ? (
              <span className={client.secondary}>{entry.email} uses a throwaway email provider. Decline it, or keep reviewing it if the provider is fine for this drop.</span>
            ) : (
              <span className={client.secondary}>Choose the entry to keep. The others are declined as duplicates.</span>
            )}
            {disposable ? null : (
              <div style={{ display: "grid", gap: 8 }} role="radiogroup" aria-label="Entry to keep">
                {group.entries.map((item) => (
                  <label key={item.id} className={styles.option}>
                    <input type="radio" name="keep" checked={keep === item.id} onChange={() => setKeep(item.id)} disabled={Boolean(item.decision) && item.decision?.decision === "declined"} />
                    <span>
                      <span className={styles.inline} style={{ justifyContent: "space-between" }}>
                        <span>{item.name ?? item.email}</span>
                        <span className={`${client.mono} ${client.muted}`}>{Object.values(item.fields)[0] ?? ""}</span>
                      </span>
                      <span className={`${client.muted} ${client.small}`}>
                        {item.email} · {shortDate(item.createdAt)}
                        {decisionText(item) ? ` · ${decisionText(item)}` : ""}
                      </span>
                      <span className={`${client.secondary} ${client.small}`} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {item.socials.length
                          ? item.socials.map((link) => (
                              <a key={link} href={/^https?:\/\//i.test(link) ? link : `https://${link}`} target="_blank" rel="noreferrer noopener" style={{ color: "inherit" }}>
                                {link.replace(/^https?:\/\/(www\.)?/i, "")} ↗
                              </a>
                            ))
                          : "No socials"}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            <label className={styles.label}>
              Reason
              <textarea className={client.textarea} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1200} placeholder={disposable ? "Disposable email address" : "Duplicate entry"} />
            </label>
            {group.kind === "phone" ? (
              <div className={styles.note}>Shared phones can be a family or a shared work number. If these are different people, mark them as not duplicates.</div>
            ) : null}
          </div>
          <div>
            {error ? <p className={client.errorText} role="alert">{error}</p> : null}
            {disposable ? (
              <button type="button" className={`${client.buttonPrimary} ${client.tall}`} disabled={!canManage || busy || !undecided.length} onClick={() => void run("all")}>
                Decline this entry
              </button>
            ) : (
              <button type="button" className={`${client.buttonPrimary} ${client.tall}`} disabled={!canManage || busy || !others.length} onClick={() => void run("keep")}>
                {others.length
                  ? `Keep ${keepEntry?.name?.split(" ")[0] ?? "this one"}, decline ${others.length} as ${others.length === 1 ? "a duplicate" : "duplicates"}`
                  : "Nothing else to decline"}
              </button>
            )}
            <span className={styles.inline} style={{ justifyContent: "space-between" }}>
              <button type="button" className={client.buttonGhost} style={{ paddingLeft: 0 }} disabled={!canManage || busy} onClick={() => void run("dismiss")}>
                {disposable ? "This provider is fine" : "Not duplicates"}
              </button>
              {disposable ? null : (
                <button type="button" className={client.button} disabled={!canManage || busy || !undecided.length} onClick={() => void run("all")}>
                  Decline all {undecided.length}
                </button>
              )}
            </span>
          </div>
        </>
      )}
    </aside>
  )
}
