"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/arc/badge/badge"
import { Button } from "@/components/arc/button/button"
import styles from "./org-personas.module.css"

type CloneStatus = {
  state: "not_a_clone" | "up_to_date" | "update_available" | "source_removed"
  sourceName: string | null
  clonedFromVersion: number | null
  latestVersion: number | null
}

type ProjectRef = { id: string; name: string }

type OwnPersona = {
  id: string
  name: string
  slug: string
  is_active: boolean
  version: number
  usedBy: ProjectRef[]
  cloneStatus: CloneStatus
}

type LibraryPersona = {
  id: string
  name: string
  slug: string
  version: number
  is_active: boolean
  is_default: boolean
  usedBy: ProjectRef[]
  clones: string[]
}

type ListResponse = { canManage: boolean; personas: OwnPersona[]; library: LibraryPersona[] }

type PersonaContent = {
  name: string
  prompt: string
  pass_threshold: number
  reject_threshold: number
  profile_schema: unknown
  profile_extractor_hint: string | null
}

type DetailResponse = {
  persona: PersonaContent & { id: string; is_active: boolean; version: number; owner_organisation_id: string | null }
  editable: boolean
  usedBy: ProjectRef[]
  cloneStatus: CloneStatus
  source: { id: string; version: number; content: PersonaContent; changedFields: string[] } | null
}

const FIELD_LABEL: Record<string, string> = {
  prompt: "Prompt",
  pass_threshold: "Pass threshold",
  reject_threshold: "Reject threshold",
  profile_schema: "Profile fields",
  profile_extractor_hint: "Extractor hint",
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : `Request failed (${response.status})`
    throw new Error(message)
  }
  return body as T
}

function usedByText(projects: ProjectRef[]): string {
  return projects.length ? projects.map((project) => project.name).join(", ") : "Not used by a project"
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  return typeof value === "string" ? value : JSON.stringify(value, null, 2)
}

export function OrgPersonasWorkspace({ orgId }: { orgId: string }) {
  const [token, setToken] = useState(0)
  const [list, setList] = useState<{ key: string; data?: ListResponse; error?: string } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ key: string; data?: DetailResponse; error?: string } | null>(null)
  const [orgName, setOrgName] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null)

  const listKey = `${orgId}|${token}`
  const detailKey = selectedId ? `${orgId}|${selectedId}|${token}` : null

  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/organisations/${orgId}`, { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { name?: string } | null) => {
        if (!cancelled && body?.name) setOrgName(body.name)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [orgId])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/organisations/${orgId}/personas`, { credentials: "same-origin", cache: "no-store" })
      .then((response) => readJson<ListResponse>(response))
      .then((data) => {
        if (!cancelled) setList({ key: listKey, data })
      })
      .catch((error: Error) => {
        if (!cancelled) setList({ key: listKey, error: error.message })
      })
    return () => {
      cancelled = true
    }
  }, [orgId, listKey])

  useEffect(() => {
    if (!detailKey || !selectedId) return
    let cancelled = false
    fetch(`/api/admin/organisations/${orgId}/personas/${selectedId}`, { credentials: "same-origin", cache: "no-store" })
      .then((response) => readJson<DetailResponse>(response))
      .then((data) => {
        if (!cancelled) setDetail({ key: detailKey, data })
      })
      .catch((error: Error) => {
        if (!cancelled) setDetail({ key: detailKey, error: error.message })
      })
    return () => {
      cancelled = true
    }
  }, [orgId, selectedId, detailKey])

  const data = list?.data
  const listLoading = list?.key !== listKey
  const current = detailKey && detail?.key === detailKey ? detail : null
  const canManage = data?.canManage ?? false
  const refresh = () => setToken((value) => value + 1)

  async function run(label: string, action: () => Promise<string | void>) {
    setBusy(label)
    setNotice(null)
    try {
      const message = await action()
      if (message) setNotice({ tone: "info", text: message })
      refresh()
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Something went wrong" })
    } finally {
      setBusy(null)
    }
  }

  function clonePersona(persona: LibraryPersona) {
    void run(`clone:${persona.id}`, async () => {
      const created = await readJson<{ id: string; name: string }>(
        await fetch(`/api/admin/organisations/${orgId}/personas`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourcePersonaId: persona.id }),
        }),
      )
      setSelectedId(created.id)
      return `${created.name} cloned. Projects keep their current persona until you choose this one in project setup.`
    })
  }

  function acceptUpdate(detailData: DetailResponse) {
    if (!detailData.source) return
    const sourceVersion = detailData.source.version
    void run("accept", async () => {
      await readJson(
        await fetch(`/api/admin/organisations/${orgId}/personas/${detailData.persona.id}/accept-update`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedVersion: sourceVersion }),
        }),
      )
      return `Updated to version ${sourceVersion} of the Groucho original.`
    })
  }

  function savePersona(detailData: DetailResponse, draft: { name: string; prompt: string; isActive: boolean }) {
    void run("save", async () => {
      await readJson(
        await fetch(`/api/admin/organisations/${orgId}/personas/${detailData.persona.id}`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...detailData.persona,
            name: draft.name,
            prompt: draft.prompt,
            is_active: draft.isActive,
          }),
        }),
      )
      return "Saved."
    })
  }

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{orgName ? `${orgName} personas` : "Personas"}</h1>
          <p className={styles.subtitle}>
            Your own personas, and the Groucho personas you can use as they are or clone to change.
          </p>
        </div>
      </header>

      {notice ? (
        <p className={notice.tone === "error" ? styles.error : styles.notice} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      ) : null}
      {list?.error && !data ? <p className={styles.error} role="alert">{list.error}</p> : null}

      <div className={styles.body}>
        <div className={styles.lists}>
          <section className={styles.section} aria-labelledby="own-personas">
            <h2 id="own-personas" className={styles.sectionTitle}>Your personas</h2>
            {listLoading && !data ? <p className={styles.muted}>Loading…</p> : null}
            {data && !data.personas.length ? (
              <p className={styles.muted}>None yet. Clone a Groucho persona below to make one you can change.</p>
            ) : null}
            <ul className={styles.rows}>
              {data?.personas.map((persona) => (
                <li key={persona.id}>
                  <button
                    type="button"
                    className={persona.id === selectedId ? styles.rowSelected : styles.row}
                    aria-current={persona.id === selectedId ? "true" : undefined}
                    onClick={() => setSelectedId(persona.id)}
                  >
                    <span className={styles.rowMain}>
                      <span className={styles.rowName}>
                        <span className={persona.is_active ? styles.dotOn : styles.dotOff} aria-hidden="true" />
                        {persona.name}
                      </span>
                      <small>{usedByText(persona.usedBy)}</small>
                    </span>
                    <span className={styles.rowMeta}>
                      {persona.cloneStatus.state === "update_available" ? (
                        <Badge tone="warning">Update available</Badge>
                      ) : persona.cloneStatus.sourceName ? (
                        <small>Based on {persona.cloneStatus.sourceName} v{persona.cloneStatus.clonedFromVersion}</small>
                      ) : persona.cloneStatus.state === "source_removed" ? (
                        <small>Original removed</small>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.section} aria-labelledby="groucho-personas">
            <h2 id="groucho-personas" className={styles.sectionTitle}>Groucho personas</h2>
            <p className={styles.muted}>Maintained by Groucho. Use one as it is, or clone it to make your own version.</p>
            <ul className={styles.rows}>
              {data?.library.map((persona) => (
                <li key={persona.id} className={persona.id === selectedId ? styles.libraryRowSelected : styles.libraryRow}>
                  <button type="button" className={styles.libraryOpen} onClick={() => setSelectedId(persona.id)}>
                    <span className={styles.rowName}>{persona.name}</span>
                    <small>
                      v{persona.version}
                      {persona.usedBy.length ? ` · used as is by ${usedByText(persona.usedBy)}` : ""}
                      {persona.clones.length ? " · cloned" : ""}
                    </small>
                  </button>
                  {canManage ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy === `clone:${persona.id}`}
                      onClick={() => clonePersona(persona)}
                    >
                      Clone
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className={styles.panel} aria-live="polite">
          {!selectedId ? (
            <p className={styles.muted}>Choose a persona to see its prompt, where it is used, and any update from Groucho.</p>
          ) : !current ? (
            <p className={styles.muted}>Loading…</p>
          ) : current.error ? (
            <p className={styles.error} role="alert">{current.error}</p>
          ) : current.data ? (
            <PersonaPanel
              key={`${current.data.persona.id}:${current.data.persona.version}`}
              detail={current.data}
              canManage={canManage}
              busy={busy}
              onSave={(draft) => savePersona(current.data!, draft)}
              onAccept={() => acceptUpdate(current.data!)}
            />
          ) : null}
        </aside>
      </div>
    </div>
  )
}

function PersonaPanel({
  detail,
  canManage,
  busy,
  onSave,
  onAccept,
}: {
  detail: DetailResponse
  canManage: boolean
  busy: string | null
  onSave: (draft: { name: string; prompt: string; isActive: boolean }) => void
  onAccept: () => void
}) {
  const { persona, cloneStatus, source } = detail
  const [name, setName] = useState(persona.name)
  const [prompt, setPrompt] = useState(persona.prompt)
  const [isActive, setIsActive] = useState(persona.is_active)
  const [reviewing, setReviewing] = useState(false)
  const editable = detail.editable && canManage
  const dirty = name !== persona.name || prompt !== persona.prompt || isActive !== persona.is_active

  return (
    <div className={styles.panelBody}>
      <div>
        <h2 className={styles.panelTitle}>{persona.name}</h2>
        <p className={styles.muted}>
          {detail.editable ? "Your persona" : "Groucho persona"} · v{persona.version} · {usedByText(detail.usedBy)}
        </p>
      </div>

      {cloneStatus.state === "update_available" && source ? (
        <div className={styles.update}>
          <p>
            Groucho updated {cloneStatus.sourceName} to v{cloneStatus.latestVersion}. Yours is based on v
            {cloneStatus.clonedFromVersion}.
            {source.changedFields.length
              ? ` Changed: ${source.changedFields.map((field) => FIELD_LABEL[field] ?? field).join(", ")}.`
              : " The content matches yours."}
          </p>
          <div className={styles.actions}>
            <Button size="sm" variant="secondary" onClick={() => setReviewing((value) => !value)} aria-expanded={reviewing}>
              {reviewing ? "Hide comparison" : "Compare"}
            </Button>
            {canManage ? (
              <Button size="sm" loading={busy === "accept"} onClick={onAccept}>
                Accept update
              </Button>
            ) : null}
          </div>
          {reviewing ? (
            <div className={styles.compare}>
              {source.changedFields.map((field) => (
                <div key={field} className={styles.compareField}>
                  <h3>{FIELD_LABEL[field] ?? field}</h3>
                  <div className={styles.compareColumns}>
                    <div>
                      <span>Yours</span>
                      <pre>{displayValue(persona[field as keyof PersonaContent])}</pre>
                    </div>
                    <div>
                      <span>Groucho v{source.version}</span>
                      <pre>{displayValue(source.content[field as keyof PersonaContent])}</pre>
                    </div>
                  </div>
                </div>
              ))}
              <p className={styles.muted}>Accepting replaces your version&apos;s content with Groucho&apos;s. Your current version stays in the history.</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {editable ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault()
            onSave({ name: name.trim(), prompt, isActive })
          }}
        >
          <label className={styles.field}>
            <span>Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} />
          </label>
          <label className={styles.field}>
            <span>Prompt</span>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={16} required />
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
            <span>Active</span>
          </label>
          <div className={styles.actions}>
            <Button type="submit" size="sm" disabled={!dirty || !name.trim() || !prompt.trim()} loading={busy === "save"}>
              Save changes
            </Button>
          </div>
        </form>
      ) : (
        <>
          {!detail.editable ? (
            <p className={styles.muted}>Groucho personas can&apos;t be changed here. Clone it to make your own version.</p>
          ) : (
            <p className={styles.muted}>Only organisation owners and admins can change personas.</p>
          )}
          <pre className={styles.prompt}>{persona.prompt}</pre>
        </>
      )}
    </div>
  )
}
