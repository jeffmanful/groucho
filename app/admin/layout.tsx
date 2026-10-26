"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import {
  ShieldCheck,
  LayoutDashboard,
  Tickets,
  MessagesSquare,
  ContactRound,
  Plus,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
  ArrowUpRight,
} from "lucide-react"
import { Button } from "@/components/arc/button/button"
import { AdminFeedbackProvider } from "@/components/admin/AdminFeedback"
import {
  AdminWorkspaceProvider,
  useAdminWorkspace,
} from "@/components/admin/AdminWorkspace"
import { OrgSwitcher } from "@/components/admin/OrgSwitcher"
import styles from "@/components/admin/admin-workspace.module.css"

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AdminWorkspaceProvider>
      <AdminFeedbackProvider>
        <WorkspaceShell>{children}</WorkspaceShell>
      </AdminFeedbackProvider>
    </AdminWorkspaceProvider>
  )
}
function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const { data } = useAdminWorkspace()
  const pathname = usePathname()
  const router = useRouter()
  const navigationRef = useRef<HTMLElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState(false)
  const [theme, setTheme] = useState<"dark" | "light">("dark")
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    if (!menu) return
    const previous = menuButtonRef.current
    const panel = navigationRef.current
    const controls = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>("a[href],button:not(:disabled)") ??
          [],
      ).filter((node) => node.getClientRects().length > 0)
    controls()[0]?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        setMenu(false)
      }
      if (event.key !== "Tab") return
      const items = controls(),
        first = items[0],
        last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener("keydown", handleKey)
    return () => {
      document.removeEventListener("keydown", handleKey)
      previous?.focus()
    }
  }, [menu])
  const themeSupported =
    pathname === "/admin" ||
    pathname.startsWith("/admin/ticket-access") ||
    pathname.startsWith("/admin/access")
  useEffect(() => {
    document.documentElement.dataset.theme = themeSupported ? theme : "dark"
    return () => {
      document.documentElement.dataset.theme = "dark"
    }
  }, [theme, themeSupported])
  const currentOrgId =
    pathname.match(/^\/admin\/organisations\/([^/]+)/)?.[1] ?? null
  const currentOrg = currentOrgId
    ? (data?.organisations.find((o) => o.id === currentOrgId) ?? null)
    : null
  const links = [
    {
      href: "/admin",
      label: "Overview",
      icon: LayoutDashboard,
    },
    {
      href: "/admin/sessions",
      label: "Sessions & reports",
      icon: MessagesSquare,
    },
    ...(data
      ? [
          {
            href: "/admin/personas",
            label: "Personas",
            icon: ContactRound,
          },
        ]
      : []),
  ]
  if (data?.actor.isPlatform)
    links.push({
      href: "/admin/access",
      label: "Admin access",
      icon: ShieldCheck,
    })
  const title = pathname.startsWith("/admin/ticket-access")
    ? "Ticket access"
    : pathname.startsWith("/admin/projects")
      ? "New project"
      : currentOrg
        ? currentOrg.name
        : pathname === "/admin/organisations"
          ? "Organisations"
          : (links.find((l) => pathname.startsWith(l.href))?.label ??
            "Workspace")
  async function logout() {
    setLoggingOut(true)
    setError("")
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" })
      if (!response.ok) throw new Error("Sign out failed. Please try again.")
      router.push("/login")
      router.refresh()
    } catch {
      setError("Sign out failed. Please try again.")
      setLoggingOut(false)
    }
  }
  return (
    <div className={styles.shell}>
      <a href="#workspace-content" className={styles.skip}>
        Skip to content
      </a>
      <aside
        ref={navigationRef}
        className={styles.sidebar}
        data-open={menu}
        aria-label="Workspace navigation"
      >
        <div className={styles.brandRow}>
          <Link
            className={styles.brand}
            href="/admin"
            onClick={() => setMenu(false)}
          >
            groucho<span className={styles.brandDot}>.</span>
          </Link>
          <button
            className={styles.mobileClose}
            onClick={() => setMenu(false)}
            aria-label="Close navigation"
          >
            <X size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <OrgSwitcher
          organisations={data?.organisations ?? []}
          isPlatform={data?.actor.isPlatform ?? false}
          onNavigate={() => setMenu(false)}
        />
        <nav aria-label="Main navigation" className={styles.nav}>
          {links.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href)
            return (
              <Link
                href={href}
                key={href}
                aria-current={active ? "page" : undefined}
                onClick={() => setMenu(false)}
              >
                <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                {label}
              </Link>
            )
          })}
        </nav>
        <Link
          className={styles.demoLink}
          href="/admin/ticket-access"
          aria-current={
            pathname.startsWith("/admin/ticket-access") ? "page" : undefined
          }
          onClick={() => setMenu(false)}
        >
          <Tickets size={18} strokeWidth={1.75} aria-hidden="true" />
          <span>
            Ticket access<small>Synthetic pilot demo</small>
          </span>
          <ArrowUpRight size={15} aria-hidden="true" strokeWidth={1.75} />
        </Link>
        <div className={styles.sidebarFooter}>
          <div className={styles.identity}>
            <span className={styles.avatar} aria-hidden="true">
              {data?.actor.email?.charAt(0).toUpperCase() ?? "G"}
            </span>
            <div>
              <span>{data?.actor.email ?? "Your account"}</span>
              <small>
                {data?.actor.kind === "platform"
                  ? "Platform access"
                  : "Member access"}
              </small>
            </div>
          </div>
          <Button
            variant="ghost"
            loading={loggingOut}
            onClick={() => void logout()}
          >
            <LogOut size={16} strokeWidth={1.75} aria-hidden="true" /> Sign out
          </Button>
          {error && <p role="alert">{error}</p>}
        </div>
      </aside>
      {menu && (
        <button
          className={styles.backdrop}
          onClick={() => setMenu(false)}
          aria-label="Close navigation overlay"
        />
      )}
      <div className={styles.mainColumn} inert={menu || undefined}>
        <header className={styles.topbar}>
          <button
            ref={menuButtonRef}
            className={styles.mobileMenu}
            aria-label="Open navigation"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <Menu size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <span>{title}</span>
          <div className={styles.topActions}>
            {themeSupported && (
              <Button
                variant="ghost"
                aria-label={
                  theme === "dark"
                    ? "Switch to light theme"
                    : "Switch to dark theme"
                }
                onClick={() =>
                  setTheme((t) => (t === "dark" ? "light" : "dark"))
                }
              >
                {theme === "dark" ? (
                  <Sun size={18} aria-hidden="true" strokeWidth={1.75} />
                ) : (
                  <Moon size={18} aria-hidden="true" strokeWidth={1.75} />
                )}
              </Button>
            )}
            {data?.organisations.some((o) => o.canCreateProject) && (
              <Link href="/admin/projects/new" className={styles.primaryLink}>
                <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
                New project
              </Link>
            )}
          </div>
        </header>
        <div id="workspace-content" className={styles.content} tabIndex={-1}>
          {children}
        </div>
      </div>
    </div>
  )
}
