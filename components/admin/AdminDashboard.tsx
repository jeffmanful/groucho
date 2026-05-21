"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import type { AdminOverviewPayload } from "@/lib/admin-overview"

const label: React.CSSProperties = {
  display: "block",
  fontSize: "0.65rem",
  letterSpacing: "0.1em",
  opacity: 0.4,
  marginBottom: "0.35rem",
}

function btn(primary: boolean): React.CSSProperties {
  return {
    background: primary ? "rgba(255,255,255,0.08)" : "transparent",
    border: primary
      ? "1px solid rgba(255,255,255,0.45)"
      : "1px solid rgba(255,255,255,0.15)",
    color: primary ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)",
    padding: "0.45rem 0.9rem",
    cursor: "pointer",
    fontSize: "0.72rem",
    letterSpacing: "0.06em",
    fontFamily: "inherit",
    textDecoration: "none",
    display: "inline-block",
  }
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.12rem 0.45rem",
        fontSize: "0.62rem",
        letterSpacing: "0.04em",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: "999px",
        opacity: 0.65,
        marginRight: "0.35rem",
      }}
    >
      {children}
    </span>
  )
}

function statusColor(status: string): string {
  if (status === "passed") return "#4ade80"
  if (status === "redirected") return "#fb923c"
  if (status === "rejected" || status === "failed") return "#f87171"
  return "rgba(255,255,255,0.45)"
}

function relativeTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime()
  const m = Math.floor(d / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function StatCard({
  title,
  value,
}: {
  title: string
  value: number | string
}) {
  return (
    <div
      style={{
        flex: "1 1 8rem",
        padding: "1rem 1.1rem",
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div style={{ ...label, marginBottom: "0.5rem" }}>{title}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 300, opacity: 0.9 }}>{value}</div>
    </div>
  )
}

export default function AdminDashboard() {
  const [data, setData] = useState<AdminOverviewPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    const res = await fetch("/api/admin/overview")
    if (!res.ok) {
      setErr("Could not load overview")
      setData(null)
      setLoading(false)
      return
    }
    setData(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const canCreateAny =
    data?.organisations.some((o) => o.canCreateProject) ?? false

  const flatProjects =
    data?.organisations.flatMap((o) =>
      o.projects.map((p) => ({
        ...p,
        orgName: o.name,
        orgSlug: o.slug,
        canEdit: o.canCreateProject,
      })),
    ) ?? []

  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: "56rem" }}>
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "1.25rem",
          marginBottom: "2rem",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "0.75rem",
              letterSpacing: "0.14em",
              fontWeight: 400,
              opacity: 0.45,
              margin: "0 0 0.35rem",
            }}
          >
            OVERVIEW
          </h1>
          <p style={{ fontSize: "0.85rem", opacity: 0.55, margin: 0 }}>
            {data?.actor.email
              ? `Signed in as ${data.actor.email}`
              : "Groucho admin"}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.65rem", flexWrap: "wrap" }}>
          {canCreateAny && (
            <Link href="/admin/projects/new" style={btn(true)}>
              New project
            </Link>
          )}
          <Link href="/admin/sessions" style={btn(false)}>
            Live sessions
          </Link>
          <Link href="/admin/organisations" style={btn(false)}>
            Organisations
          </Link>
          {data?.actor.isPlatform && (
            <Link href="/admin/personas" style={btn(false)}>
              Personas
            </Link>
          )}
        </div>
      </header>

      {err && (
        <p style={{ color: "#f87171", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
          {err}
        </p>
      )}

      {loading && (
        <p style={{ opacity: 0.35, fontSize: "0.85rem" }}>Loading overview…</p>
      )}

      {!loading && data && (
        <>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.75rem",
              marginBottom: "2rem",
            }}
          >
            <StatCard title="ORGANISATIONS" value={data.stats.organisations} />
            <StatCard title="PROJECTS" value={data.stats.projects} />
            <StatCard title="ACTIVE SESSIONS" value={data.stats.activeSessions} />
            <StatCard
              title="SESSIONS TODAY"
              value={data.stats.sessionsToday}
            />
            <StatCard
              title="COMPLETED TODAY"
              value={data.stats.completedSessionsToday}
            />
          </div>

          {data.organisations.length === 0 && (
            <section
              style={{
                padding: "1.5rem",
                border: "1px solid rgba(255,255,255,0.1)",
                marginBottom: "2rem",
              }}
            >
              <h2 style={{ ...label, fontSize: "0.8rem", opacity: 0.55 }}>
                No organisations
              </h2>
              <p style={{ fontSize: "0.82rem", opacity: 0.45, lineHeight: 1.5 }}>
                {data.actor.isPlatform ? (
                  <>
                    Create an organisation from{" "}
                    <Link
                      href="/admin/organisations"
                      style={{ color: "rgba(255,255,255,0.7)" }}
                    >
                      Organisations
                    </Link>
                    .
                  </>
                ) : (
                  <>
                    You are not a member of any organisation yet. Accept an invite
                    or{" "}
                    <Link
                      href="/signup/organisation"
                      style={{ color: "rgba(255,255,255,0.7)" }}
                    >
                      create one
                    </Link>
                    .
                  </>
                )}
              </p>
            </section>
          )}

          {data.organisations.length > 0 && flatProjects.length === 0 && (
            <section
              style={{
                padding: "1.5rem",
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.03)",
                marginBottom: "2rem",
              }}
            >
              <h2 style={{ ...label, fontSize: "0.8rem", opacity: 0.55 }}>
                Create your first project
              </h2>
              <p
                style={{
                  fontSize: "0.82rem",
                  opacity: 0.45,
                  marginBottom: "1rem",
                  lineHeight: 1.5,
                }}
              >
                Projects power gatekeeper and onboarding conversations. Use the
                guided wizard to configure flow type, persona, and integration
                settings.
              </p>
              {canCreateAny && (
                <Link href="/admin/projects/new" style={btn(true)}>
                  New project
                </Link>
              )}
            </section>
          )}

          {flatProjects.length > 0 && (
            <section style={{ marginBottom: "2.5rem" }}>
              <h2 style={{ ...label, marginBottom: "0.75rem" }}>PROJECTS</h2>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {flatProjects.map((p) => (
                  <li
                    key={p.id}
                    style={{
                      padding: "0.85rem 0",
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: "0.5rem",
                      }}
                    >
                      <span style={{ fontSize: "0.9rem", opacity: 0.9 }}>
                        {p.name}
                      </span>
                      <span
                        style={{
                          fontFamily: "monospace",
                          fontSize: "0.68rem",
                          opacity: 0.35,
                        }}
                      >
                        {p.slug}
                      </span>
                      <span style={{ fontSize: "0.72rem", opacity: 0.4 }}>
                        {p.orgName}
                      </span>
                    </div>
                    <div style={{ marginTop: "0.45rem" }}>
                      <Chip>{p.projectType}</Chip>
                      {p.environment && <Chip>{p.environment}</Chip>}
                      {p.sessionMode && <Chip>{p.sessionMode}</Chip>}
                      {p.activeSessions > 0 && (
                        <Chip>{p.activeSessions} active</Chip>
                      )}
                    </div>
                    <div
                      style={{
                        marginTop: "0.65rem",
                        display: "flex",
                        gap: "0.5rem",
                        flexWrap: "wrap",
                      }}
                    >
                      <Link
                        href={`/admin/organisations/${p.organisationId}?project=${p.id}`}
                        style={{ ...btn(false), fontSize: "0.62rem" }}
                      >
                        Open org
                      </Link>
                      {p.canEdit && (
                        <Link
                          href={`/admin/organisations/${p.organisationId}/projects/${p.id}/edit`}
                          style={{ ...btn(false), fontSize: "0.62rem" }}
                        >
                          Edit project
                        </Link>
                      )}
                      <Link
                        href={`/admin/sessions`}
                        style={{ ...btn(false), fontSize: "0.62rem" }}
                      >
                        Live sessions
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                marginBottom: "0.75rem",
              }}
            >
              <h2 style={{ ...label, marginBottom: 0 }}>RECENT ACTIVITY</h2>
              <Link
                href="/admin/sessions"
                style={{
                  fontSize: "0.65rem",
                  opacity: 0.4,
                  color: "#fff",
                  textDecoration: "none",
                }}
              >
                View all →
              </Link>
            </div>
            {data.recentSessions.length === 0 ? (
              <p style={{ opacity: 0.35, fontSize: "0.8rem" }}>
                No sessions yet.
              </p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {data.recentSessions.map((s) => (
                  <li
                    key={s.id}
                    style={{
                      padding: "0.65rem 0",
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: "0.75rem",
                      fontSize: "0.78rem",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "monospace",
                        opacity: 0.45,
                        minWidth: "7rem",
                      }}
                    >
                      {s.clientSessionKey.slice(0, 10)}…
                    </span>
                    <span style={{ color: statusColor(s.status) }}>
                      {s.status}
                    </span>
                    <span style={{ opacity: 0.55 }}>
                      {s.projectName}
                      <span style={{ opacity: 0.35 }}> · {s.orgName}</span>
                    </span>
                    <span style={{ opacity: 0.3, marginLeft: "auto" }}>
                      {relativeTime(s.updatedAt)}
                    </span>
                    <Link
                      href={`/admin/organisations/${s.orgId}?project=${s.projectId}&session=${s.id}`}
                      style={{
                        fontSize: "0.62rem",
                        opacity: 0.45,
                        color: "#fff",
                        textDecoration: "none",
                      }}
                    >
                      Transcript
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
