"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState, type CSSProperties } from "react"
import type { OrganisationSummary } from "@/lib/organisation-summary"
import styles from "./dashboard.module.css"

type Response = { isPlatform: boolean; organisations: OrganisationSummary[] }

const COLUMNS = { "--columns": "minmax(0, 2fr) minmax(0, 1.3fr) minmax(0, 0.8fr) minmax(0, 0.8fr) minmax(0, 1.1fr) minmax(0, 0.7fr)" } as CSSProperties

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)
}

export function organisationStatus(org: OrganisationSummary): { tone: "attention" | "live" | "idle"; label: string } {
  const active = org.projects.filter((project) => !project.archived)
  if (org.review.available && org.review.toReview > 0) return { tone: "attention", label: "Needs review" }
  if (active.some((project) => project.environment === "live" && project.conversations30d > 0)) return { tone: "live", label: "Live" }
  if (active.some((project) => project.conversations30d > 0)) return { tone: "live", label: "Active" }
  return { tone: "idle", label: active.length ? "Not live yet" : "No projects yet" }
}

function OrganisationRow({ org }: { org: OrganisationSummary }) {
  const status = organisationStatus(org)
  const active = org.projects.filter((project) => !project.archived)
  const conversations = active.reduce((sum, project) => sum + project.conversations30d, 0)
  return (
    <Link href={`/admin/organisations/${org.id}`} className={styles.row} style={COLUMNS}>
      <span className={styles.name}>
        <span className={styles.mark} aria-hidden="true">{org.name.charAt(0).toUpperCase()}</span>
        {org.name}
      </span>
      <span className={styles.status}>
        <span className={status.tone === "attention" ? styles.dotAttention : status.tone === "live" ? styles.dotLive : styles.dotIdle} aria-hidden="true" />
        {status.label}
      </span>
      <span className={`${styles.num} ${org.review.toReview ? styles.attention : styles.dim}`}>
        {org.review.available ? org.review.toReview : "–"}
      </span>
      <span className={styles.num}>{active.length}</span>
      <span className={`${styles.num} ${conversations ? "" : styles.dim}`}>{conversations}</span>
      <span className={styles.num}>{org.memberCount}</span>
    </Link>
  )
}

function OrganisationTable({ organisations }: { organisations: OrganisationSummary[] }) {
  return (
    <div className={styles.table}>
      <div className={styles.tableInner}>
        <div className={styles.head} style={COLUMNS}>
          <span>Name</span>
          <span>Status</span>
          <span className={styles.num}>To review</span>
          <span className={styles.num}>Projects</span>
          <span className={styles.num}>Conversations, 30d</span>
          <span className={styles.num}>Members</span>
        </div>
        {organisations.map((org) => <OrganisationRow key={org.id} org={org} />)}
      </div>
    </div>
  )
}

export function OrganisationsHome() {
  const router = useRouter()
  const [token, setToken] = useState(0)
  const [result, setResult] = useState<{ data?: Response; error?: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugEdited, setSlugEdited] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/admin/organisation-summaries", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Organisations could not be loaded.")
        const data = body as Response
        // A member of a single organisation goes straight to it.
        if (!data.isPlatform && data.organisations.length === 1) {
          router.replace(`/admin/organisations/${data.organisations[0].id}`)
          return
        }
        setResult({ data })
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setResult({ error: error.message })
      })
    return () => controller.abort()
  }, [router, token])

  async function createOrganisation(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      const response = await fetch("/api/admin/organisations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug: slugEdited ? slug : slugify(name) }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The organisation could not be created.")
      if (typeof body.id === "string") {
        router.push(`/admin/organisations/${body.id}`)
        return
      }
      setCreating(false)
      setName("")
      setSlug("")
      setToken((value) => value + 1)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The organisation could not be created.")
    } finally {
      setSaving(false)
    }
  }

  const organisations = result?.data?.organisations ?? []
  const withMembers = organisations.filter((org) => org.memberCount > 0)
  const withoutMembers = organisations.filter((org) => org.memberCount === 0)

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Organisations</h1>
          <p className={styles.subtitle}>Choose a client to see its projects, applications and personas.</p>
        </div>
        {result?.data?.isPlatform ? (
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => setCreating((value) => !value)} aria-expanded={creating}>
              New organisation
            </button>
          </div>
        ) : null}
      </header>

      {creating ? (
        <form className={styles.form} onSubmit={createOrganisation}>
          <label className={styles.field}>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} required autoFocus maxLength={120} />
          </label>
          <label className={styles.field}>
            Slug
            <input
              value={slugEdited ? slug : slugify(name)}
              onChange={(event) => {
                setSlugEdited(true)
                setSlug(event.target.value)
              }}
              required
              maxLength={60}
            />
          </label>
          <button type="submit" className={styles.primary} disabled={saving || !name.trim()}>
            {saving ? "Creating…" : "Create"}
          </button>
          <button type="button" className={styles.secondary} onClick={() => setCreating(false)}>Cancel</button>
          {formError ? <p className={styles.error} role="alert" style={{ flexBasis: "100%" }}>{formError}</p> : null}
        </form>
      ) : null}

      {!result ? <div className={styles.skeleton} aria-label="Loading organisations" /> : null}
      {result?.error ? (
        <p className={styles.error} role="alert">
          {result.error}{" "}
          <button type="button" className={styles.rowAction} onClick={() => setToken((value) => value + 1)}>Try again</button>
        </p>
      ) : null}

      {result?.data ? (
        withMembers.length ? (
          <OrganisationTable organisations={withMembers} />
        ) : (
          <p className={styles.empty}>
            {organisations.length ? "No organisation has members yet." : "You're not a member of any organisation yet. Ask an organisation owner to invite you."}
          </p>
        )
      ) : null}

      {withoutMembers.length ? (
        <section className={styles.section} aria-labelledby="no-members">
          <h2 id="no-members" className={styles.sectionTitleMuted}>No members yet</h2>
          <OrganisationTable organisations={withoutMembers} />
        </section>
      ) : null}
    </div>
  )
}
