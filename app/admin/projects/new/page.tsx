"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

type Organisation = {
  id: string
  name: string
  slug: string
}

const label: React.CSSProperties = {
  display: "block",
  fontSize: "0.65rem",
  letterSpacing: "0.1em",
  opacity: 0.4,
  marginBottom: "0.35rem",
}

function btn(primary: boolean): React.CSSProperties {
  return {
    background: "transparent",
    border: primary
      ? "1px solid rgba(255,255,255,0.45)"
      : "1px solid rgba(255,255,255,0.15)",
    color: primary ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)",
    padding: "0.4rem 0.85rem",
    cursor: "pointer",
    fontSize: "0.72rem",
    letterSpacing: "0.06em",
    fontFamily: "inherit",
  }
}

export default function NewProjectPickerPage() {
  const router = useRouter()
  const [orgs, setOrgs] = useState<Organisation[]>([])
  const [creatable, setCreatable] = useState<Organisation[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    const [orgRes, overviewRes] = await Promise.all([
      fetch("/api/admin/organisations"),
      fetch("/api/admin/overview"),
    ])
    if (!orgRes.ok) {
      setErr("Could not load organisations")
      setLoading(false)
      return
    }
    const list: Organisation[] = await orgRes.json()
    setOrgs(list)

    let canCreate = new Set<string>()
    if (overviewRes.ok) {
      const overview: {
        organisations?: { id: string; canCreateProject?: boolean }[]
      } = await overviewRes.json()
      canCreate = new Set(
        (overview.organisations ?? [])
          .filter((o) => o.canCreateProject)
          .map((o) => o.id),
      )
    } else {
      canCreate = new Set(list.map((o) => o.id))
    }

    const allowed = list.filter((o) => canCreate.has(o.id))
    setCreatable(allowed)

    if (allowed.length === 1) {
      router.replace(`/admin/organisations/${allowed[0].id}/projects/new`)
      return
    }

    if (allowed.length > 0) setSelectedId(allowed[0].id)
    setLoading(false)
  }, [router])

  useEffect(() => {
    void load()
  }, [load])

  function continueToWizard() {
    if (!selectedId) return
    router.push(`/admin/organisations/${selectedId}/projects/new`)
  }

  if (loading) {
    return (
      <div style={{ padding: "2rem", opacity: 0.4, fontFamily: "system-ui, sans-serif" }}>
        Loading…
      </div>
    )
  }

  return (
    <div
      style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: "32rem" }}
    >
      <Link
        href="/admin"
        style={{ fontSize: "0.7rem", opacity: 0.35, color: "#fff", textDecoration: "none" }}
      >
        ← Overview
      </Link>

      <h1
        style={{
          fontSize: "0.75rem",
          letterSpacing: "0.14em",
          fontWeight: 400,
          opacity: 0.45,
          margin: "1.5rem 0 0.5rem",
        }}
      >
        NEW PROJECT
      </h1>
      <p style={{ fontSize: "0.78rem", opacity: 0.4, marginBottom: "1.5rem", lineHeight: 1.5 }}>
        Choose which organisation this project belongs to. The guided wizard
        configures gatekeeper or onboarding flow, persona, and integrations.
      </p>

      {err && (
        <p style={{ color: "#f87171", fontSize: "0.85rem", marginBottom: "1rem" }}>
          {err}
        </p>
      )}

      {creatable.length === 0 && (
        <section
          style={{
            padding: "1.25rem",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          <p style={{ fontSize: "0.82rem", opacity: 0.5, lineHeight: 1.5 }}>
            You do not have permission to create projects in any organisation.
            Ask an org admin or owner for access, or{" "}
            <Link href="/admin/organisations" style={{ color: "rgba(255,255,255,0.65)" }}>
              open organisations
            </Link>
            .
          </p>
        </section>
      )}

      {creatable.length > 0 && (
        <>
          <label style={label}>ORGANISATION</label>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            style={{
              width: "100%",
              maxWidth: "28rem",
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "#fff",
              padding: "0.45rem 0.5rem",
              fontFamily: "inherit",
              fontSize: "0.85rem",
              marginBottom: "1.25rem",
            }}
          >
            {creatable.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.slug})
              </option>
            ))}
          </select>
          {orgs.length > creatable.length && (
            <p style={{ fontSize: "0.72rem", opacity: 0.35, marginBottom: "1rem" }}>
              Showing {creatable.length} of {orgs.length} organisations where you
              can create projects.
            </p>
          )}
          <button type="button" style={btn(true)} onClick={continueToWizard}>
            Continue to wizard
          </button>
        </>
      )}
    </div>
  )
}
