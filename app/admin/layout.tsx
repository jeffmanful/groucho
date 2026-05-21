"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { AdminFeedbackProvider } from "@/components/admin/AdminFeedback"

type SessionKind = "platform" | "member" | null

function navLinkStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: "0.7rem",
    letterSpacing: "0.08em",
    color: active ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.4)",
    textDecoration: "none",
    borderBottom: active ? "1px solid rgba(255,255,255,0.35)" : "none",
    paddingBottom: "0.15rem",
  }
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [sessionKind, setSessionKind] = useState<SessionKind>(null)
  const [canCreateProject, setCanCreateProject] = useState(false)

  const loadSession = useCallback(async () => {
    const res = await fetch("/api/admin/session")
    if (!res.ok) {
      setSessionKind(null)
      setCanCreateProject(false)
      return
    }
    const j: { kind: string } = await res.json()
    setSessionKind(j.kind === "platform" || j.kind === "member" ? j.kind : null)
  }, [])

  const loadOverviewFlags = useCallback(async () => {
    const res = await fetch("/api/admin/overview")
    if (!res.ok) {
      setCanCreateProject(false)
      return
    }
    const data: {
      organisations?: { canCreateProject?: boolean }[]
    } = await res.json()
    setCanCreateProject(
      (data.organisations ?? []).some((o) => o.canCreateProject),
    )
  }, [])

  useEffect(() => {
    void loadSession()
    void loadOverviewFlags()
  }, [loadSession, loadOverviewFlags])

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" })
    router.push("/login")
    router.refresh()
  }

  const isOverview =
    pathname === "/admin" || pathname === "/admin/"
  const isSessions = pathname?.startsWith("/admin/sessions")
  const isOrgs = pathname?.startsWith("/admin/organisations")
  const isPersonas = pathname?.startsWith("/admin/personas")
  const isNewProject = pathname?.startsWith("/admin/projects/new")

  return (
    <AdminFeedbackProvider>
    <div style={{ minHeight: "100vh" }}>
      <div
        style={{
          padding: "1.25rem 2rem",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          gap: "1.25rem",
          flexWrap: "wrap",
        }}
      >
        <Link
          href="/admin"
          style={{
            fontSize: "0.7rem",
            letterSpacing: "0.12em",
            opacity: 0.3,
            color: "#fff",
            textDecoration: "none",
          }}
        >
          Groucho / ADMIN
          {sessionKind === "member" && (
            <span style={{ marginLeft: "0.75rem", opacity: 0.45 }}>· org member</span>
          )}
        </Link>
        <nav
          style={{
            display: "flex",
            gap: "1rem",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <Link href="/admin" style={navLinkStyle(isOverview)}>
            Overview
          </Link>
          <Link href="/admin/sessions" style={navLinkStyle(isSessions)}>
            Sessions
          </Link>
          <Link href="/admin/organisations" style={navLinkStyle(isOrgs)}>
            Organisations
          </Link>
          {sessionKind === "platform" ? (
            <Link href="/admin/personas" style={navLinkStyle(isPersonas)}>
              Personas
            </Link>
          ) : sessionKind === "member" ? (
            <Link
              href="/admin/personas"
              style={{
                ...navLinkStyle(isPersonas),
                opacity: isPersonas ? undefined : 0.28,
              }}
              title="Read-only list for project wizard"
            >
              Personas
            </Link>
          ) : null}
          {canCreateProject && (
            <Link
              href="/admin/projects/new"
              style={{
                ...navLinkStyle(isNewProject),
                marginLeft: "0.25rem",
                border: "1px solid rgba(255,255,255,0.2)",
                padding: "0.2rem 0.55rem",
                borderRadius: 0,
              }}
            >
              + New project
            </Link>
          )}
        </nav>
        <button
          type="button"
          onClick={() => void logout()}
          style={{
            marginLeft: "auto",
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "rgba(255,255,255,0.35)",
            padding: "0.25rem 0.55rem",
            fontSize: "0.65rem",
            letterSpacing: "0.06em",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Sign out
        </button>
      </div>
      {children}
    </div>
    </AdminFeedbackProvider>
  )
}
