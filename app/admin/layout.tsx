"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import {
  ArrowLeft,
  Building2,
  ChevronsUpDown,
  ClipboardCheck,
  ContactRound,
  FolderClosed,
  House,
  Inbox,
  ListChecks,
  LogOut,
  Rows3,
  UsersRound,
  Menu,
  Settings,
  ShieldCheck,
  Tickets,
  X,
  FlaskConical,
} from "lucide-react"
import { Button } from "@/components/arc/button/button"
import { AdminFeedbackProvider } from "@/components/admin/AdminFeedback"
import {
  AdminWorkspaceProvider,
  useAdminWorkspace,
} from "@/components/admin/AdminWorkspace"
import {
  OrganisationSummaryProvider,
  useOrganisationSummary,
} from "@/components/admin/dashboard/OrganisationSummaryContext"
import styles from "@/components/admin/admin-workspace.module.css"
import { ThemeToggle, useThemePreference } from "@/components/admin/ThemeToggle"

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const orgId = organisationIdFrom(pathname)
  return (
    <AdminWorkspaceProvider>
      <AdminFeedbackProvider>
        <OrganisationSummaryProvider orgId={orgId}>
          <WorkspaceShell orgId={orgId}>{children}</WorkspaceShell>
        </OrganisationSummaryProvider>
      </AdminFeedbackProvider>
    </AdminWorkspaceProvider>
  )
}

function organisationIdFrom(pathname: string): string | null {
  const match = /^\/admin\/organisations\/([^/]+)/.exec(pathname)
  return match ? decodeURIComponent(match[1]) : null
}

type NavLink = {
  href: string
  label: string
  icon: typeof House
  active: boolean
  count?: number | null
  attention?: boolean
}

function OrganisationSwitcher({ orgId, onNavigate }: { orgId: string; onNavigate: () => void }) {
  const { data } = useAdminWorkspace()
  const { summary } = useOrganisationSummary()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const organisations = data?.organisations ?? []
  const current = organisations.find((organisation) => organisation.id === orgId)
  const name = summary?.name ?? current?.name ?? "Organisation"

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", close)
    document.addEventListener("keydown", close)
    return () => {
      document.removeEventListener("mousedown", close)
      document.removeEventListener("keydown", close)
    }
  }, [open])

  const choose = () => {
    setOpen(false)
    onNavigate()
  }

  return (
    <div className={styles.switcher} ref={containerRef}>
      <button
        type="button"
        className={styles.switcherButton}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${name}. Switch organisation`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.orgMark} aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
        <span>{name}</span>
        <ChevronsUpDown size={14} strokeWidth={1.75} aria-hidden="true" color="var(--text-muted)" />
      </button>
      {open ? (
        <ul className={styles.switcherMenu}>
          {organisations.map((organisation) => (
            <li key={organisation.id}>
              <Link
                href={`/admin/organisations/${organisation.id}`}
                aria-current={organisation.id === orgId ? "true" : undefined}
                onClick={choose}
              >
                <span className={organisation.id === orgId ? styles.orgMark : styles.orgMarkMuted} aria-hidden="true">
                  {organisation.name.charAt(0).toUpperCase()}
                </span>
                {organisation.name}
              </Link>
            </li>
          ))}
          <li aria-hidden="true"><hr /></li>
          <li>
            <Link href="/admin" onClick={choose}>All organisations</Link>
          </li>
        </ul>
      ) : null}
    </div>
  )
}

function WorkspaceShell({ children, orgId }: { children: React.ReactNode; orgId: string | null }) {
  const { data } = useAdminWorkspace()
  const { summary } = useOrganisationSummary()
  const pathname = usePathname()
  const router = useRouter()
  const navigationRef = useRef<HTMLElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState(false)
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
  const theme = useThemePreference()
  // Older setup and conversation pages are still drawn for the dark theme only.
  const darkOnly = /\/projects\/(new|[^/]+\/(edit|cultural-signals))|\/advanced|^\/admin\/(sessions|projects\/new|personas)/.test(pathname)
  const resolvedTheme = darkOnly ? "dark" : theme.resolved
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
  }, [resolvedTheme])

  const isPlatform = data?.actor.isPlatform ?? false
  const base = orgId ? `/admin/organisations/${orgId}` : ""
  const activeProjects = summary ? summary.projects.filter((project) => !project.archived).length : null
  const orgLinks: NavLink[] = orgId
    ? [
        { href: base, label: "Overview", icon: House, active: pathname === base },
        {
          href: `${base}/needs-you`,
          label: "Needs you",
          icon: Inbox,
          active: pathname.startsWith(`${base}/needs-you`) || /\/applications\/[^/]+\/[^/]+/.test(pathname),
          count: summary?.review.available && summary.review.toReview ? summary.review.toReview : null,
          attention: Boolean(summary?.review.toReview),
        },
        { href: `${base}/entries`, label: "Entries", icon: Rows3, active: pathname.startsWith(`${base}/entries`) },
        { href: `${base}/cohorts`, label: "Cohorts", icon: UsersRound, active: pathname.startsWith(`${base}/cohorts`) },
        { href: `${base}/decisions`, label: "Decisions", icon: ListChecks, active: pathname.startsWith(`${base}/decisions`) },
        {
          href: `${base}/applications`,
          label: "Applications",
          icon: ClipboardCheck,
          active: pathname === `${base}/applications`,
        },
        { href: `${base}/projects`, label: "Projects", icon: FolderClosed, active: pathname.startsWith(`${base}/projects`), count: activeProjects },
        { href: `${base}/personas`, label: "Personas", icon: ContactRound, active: pathname.startsWith(`${base}/personas`), count: summary?.personasInUse.length ?? null },
        { href: `${base}/settings`, label: "Members & settings", icon: Settings, active: pathname.startsWith(`${base}/settings`) },
      ]
    : []
  const workspaceLinks: NavLink[] = [
    { href: "/admin", label: "Organisations", icon: Building2, active: pathname === "/admin" },
    ...(isPlatform
      ? [{ href: "/admin/personas", label: "Persona library", icon: ContactRound, active: pathname.startsWith("/admin/personas") }]
      : []),
  ]
  const demoLinks: NavLink[] = [
    { href: "/admin/applications?project=sample-community", label: "Sample applications", icon: FlaskConical, active: pathname.startsWith("/admin/applications") },
    { href: "/admin/ticket-access", label: "Ticket access", icon: Tickets, active: pathname.startsWith("/admin/ticket-access") },
  ]
  const platformLinks: NavLink[] = isPlatform
    ? [{ href: "/admin/access", label: "Admin access", icon: ShieldCheck, active: pathname.startsWith("/admin/access") }]
    : []
  const showAllOrganisations = isPlatform || (data?.organisations.length ?? 0) > 1

  // A way back from pages below a section (project setup, a new project) to the section itself.
  const deeper = orgId && /\/projects\/(new|[^/]+\/edit)/.test(pathname)

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

  const renderLinks = (links: NavLink[]) =>
    links.map(({ href, label, icon: Icon, active, count, attention }) => (
      <Link href={href} key={href} aria-current={active ? "page" : undefined} onClick={() => setMenu(false)}>
        <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
        <span>{label}</span>
        {typeof count === "number" ? (
          <span className={attention ? styles.countAttention : styles.count}>{count}</span>
        ) : null}
      </Link>
    ))

  return (
    <div className={styles.shell} data-theme={resolvedTheme}>
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
          <Link className={styles.brand} href="/admin" onClick={() => setMenu(false)}>
            groucho<span className={styles.brandDot}>.</span>
          </Link>
          <button className={styles.mobileClose} onClick={() => setMenu(false)} aria-label="Close navigation">
            <X size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        {orgId ? (
          <>
            <OrganisationSwitcher orgId={orgId} onNavigate={() => setMenu(false)} />
            <nav aria-label="Organisation" className={styles.nav}>
              {renderLinks(orgLinks)}
            </nav>
          </>
        ) : (
          <>
            <nav aria-label="Workspace" className={styles.nav}>
              {renderLinks(workspaceLinks)}
            </nav>
            <div>
              <h2 className={styles.navHeading}>Demos</h2>
              <nav aria-label="Demos" className={styles.nav}>
                {renderLinks(demoLinks)}
              </nav>
            </div>
            {platformLinks.length ? (
              <div>
                <h2 className={styles.navHeading}>Platform</h2>
                <nav aria-label="Platform" className={styles.nav}>
                  {renderLinks(platformLinks)}
                </nav>
              </div>
            ) : null}
          </>
        )}

        <div className={styles.sidebarFooter}>
          {orgId && showAllOrganisations ? (
            <Link className={styles.backLink} href="/admin" onClick={() => setMenu(false)}>
              <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
              All organisations
            </Link>
          ) : null}
          <ThemeToggle preference={theme.preference} onChange={theme.setPreference} />
          <div className={styles.identity}>
            <span className={styles.avatar} aria-hidden="true">
              {data?.actor.email?.charAt(0).toUpperCase() ?? "G"}
            </span>
            <div>
              <span>{data?.actor.email ?? "Your account"}</span>
              <small>{data?.actor.kind === "platform" ? "Platform admin" : "Member"}</small>
            </div>
          </div>
          <Button variant="ghost" size="sm" loading={loggingOut} onClick={() => void logout()}>
            <LogOut size={16} strokeWidth={1.75} aria-hidden="true" /> Sign out
          </Button>
          {error && <p role="alert">{error}</p>}
        </div>
      </aside>
      {menu && (
        <button className={styles.backdrop} onClick={() => setMenu(false)} aria-label="Close navigation overlay" />
      )}
      <div className={styles.mainColumn} inert={menu || undefined}>
        <header className={deeper ? styles.topbar : `${styles.topbar} ${styles.topbarMobileOnly}`}>
          <button
            ref={menuButtonRef}
            className={styles.mobileMenu}
            aria-label="Open navigation"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <Menu size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
          {deeper ? (
            <nav aria-label="Breadcrumb" className={styles.crumbs}>
              <Link href={`${base}/projects`}>
                <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 6 }} />
                Projects
              </Link>
            </nav>
          ) : null}
        </header>
        <div id="workspace-content" className={styles.content} tabIndex={-1}>
          {children}
        </div>
      </div>
    </div>
  )
}
