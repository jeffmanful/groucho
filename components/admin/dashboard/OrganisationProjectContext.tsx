"use client"

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useAdminWorkspace } from "@/components/admin/AdminWorkspace"
import { useOrganisationSummary } from "./OrganisationSummaryContext"
import { isProjectView, projectInPath, projectStorageKey, projectSwitchHref, resolveProjectSelection, withProject } from "@/lib/admin-project-selection"
import type { ProjectSummary } from "@/lib/organisation-summary"
import styles from "../admin-workspace.module.css"
import dashboard from "./dashboard.module.css"

type Selection = {
  project: ProjectSummary | null
  projects: ProjectSummary[]
  loading: boolean
  unavailable: boolean
  choose: (id: string) => void
  href: (path: string) => string
}
const Context = createContext<Selection>({ project: null, projects: [], loading: true, unavailable: false, choose: () => {}, href: (path) => path })

const selectionMemory = new Map<string, string>()
const selectionEvent = "groucho-project-changed"

function rememberProject(key: string, id: string) {
  selectionMemory.set(key, id)
  try { window.localStorage.setItem(key, id) } catch { /* The URL and in-memory selection still work. */ }
  window.dispatchEvent(new Event(selectionEvent))
}

function useRememberedProject(key: string | null) {
  const subscribe = useCallback((notify: () => void) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) { if (key) selectionMemory.delete(key); notify() }
    }
    window.addEventListener("storage", onStorage)
    window.addEventListener(selectionEvent, notify)
    return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(selectionEvent, notify) }
  }, [key])
  const snapshot = useCallback(() => {
    if (!key) return undefined
    if (selectionMemory.has(key)) return selectionMemory.get(key)!
    try { return window.localStorage.getItem(key) } catch { return null }
  }, [key])
  return useSyncExternalStore(subscribe, snapshot, () => undefined)
}

export function OrganisationProjectProvider({ children }: { children: ReactNode }) {
  const { data } = useAdminWorkspace()
  const { orgId, summary, loading: summaryLoading } = useOrganisationSummary()
  // Account and organisation changes get a fresh storage read, without carrying another client's selection.
  const identity = data ? `${data.actor.kind}:${data.actor.userId ?? data.actor.email ?? "platform"}` : null
  const storageKey = orgId && identity ? projectStorageKey(identity, orgId) : null
  return <ProjectSelection key={storageKey ?? "loading"} storageKey={storageKey} orgId={orgId} summaryLoading={summaryLoading} projects={summary?.projects ?? []}>{children}</ProjectSelection>
}

function ProjectSelection({ children, storageKey, orgId, projects: allProjects, summaryLoading }: {
  children: ReactNode; storageKey: string | null; orgId: string | null; projects: ProjectSummary[]; summaryLoading: boolean
}) {
  const pathname = usePathname()
  const params = useSearchParams()
  const router = useRouter()
  const remembered = useRememberedProject(storageKey)
  const projects = allProjects.filter((project) => !project.archived && project.projectType !== "ticket_access")
  const requested = projectInPath(pathname) ?? params.get("project")
  const { project, unavailable } = resolveProjectSelection(projects, requested, remembered ?? null)
  const loading = Boolean(orgId) && (!storageKey || remembered === undefined || (summaryLoading && !project))

  useEffect(() => {
    if (loading || !project || !storageKey) return
    if (remembered !== project.id) rememberProject(storageKey, project.id)
    // Canonical URLs make reload, browser history and copied links show the same project.
    if (isProjectView(pathname) && params.get("project") !== project.id) {
      window.history.replaceState(null, "", withProject(`${pathname}${params.size ? `?${params}` : ""}${window.location.hash}`, project.id))
    }
  }, [loading, project, storageKey, pathname, params, remembered])

  const choose = (id: string) => {
    if (!orgId || !projects.some((project) => project.id === id)) return
    router.push(projectSwitchHref(pathname, params.toString(), orgId, id))
  }
  return <Context.Provider value={{ project: loading ? null : project, projects, loading, unavailable, choose, href: (path) => withProject(path, loading ? null : project?.id ?? requested ?? remembered ?? null) }}>{children}</Context.Provider>
}

export function useOrganisationProject() { return useContext(Context) }

export function OrganisationProjectSwitch({ label = "Project" }: { label?: string }) {
  const { projects, project, loading, choose } = useOrganisationProject()
  return (
    <label className={styles.projectField}>
      <span>{label}</span>
      <select aria-label="Project" value={project?.id ?? ""} disabled={loading || !projects.length} onChange={(event) => choose(event.target.value)}>
        <option value="" disabled>{loading ? "Loading projects…" : projects.length ? "Select a project" : "No active projects"}</option>
        {projects.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    </label>
  )
}

export function OrganisationProjectGate({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { project, projects, loading, unavailable } = useOrganisationProject()
  const { error: summaryError, refresh } = useOrganisationSummary()
  const { error: workspaceError, retry } = useAdminWorkspace()
  const error = summaryError ?? workspaceError
  if (!isProjectView(pathname)) return children
  if (error) return <div className={dashboard.page}><p className={dashboard.error} role="alert">{error}</p><button className={dashboard.secondary} onClick={() => { refresh(); retry() }}>Try again</button></div>
  if (loading) return <div className={dashboard.page}><p role="status">Loading projects…</p></div>
  if (!project) return (
    <div className={dashboard.page}>
      <header className={dashboard.header}><h1 className={dashboard.title}>{unavailable ? "Project unavailable" : "Choose a project"}</h1></header>
      <p className={dashboard.subtitle}>{unavailable ? "The selected project is archived or no longer available to you. Select another project to continue." : projects.length ? "Select the project whose applications you want to view. Your selection carries across the dashboard." : "There are no active projects available in this organisation."}</p>
      {projects.length ? <OrganisationProjectSwitch /> : null}
    </div>
  )
  // Remount project views on a switch so open dialogs, selections and old responses cannot cross projects.
  return <div key={project.id}>{children}</div>
}
