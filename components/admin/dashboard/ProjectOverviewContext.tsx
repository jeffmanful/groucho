"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import { useOrganisationProject } from "./OrganisationProjectContext"
import { useOrganisationSummary } from "./OrganisationSummaryContext"
import type { ProjectOverview } from "@/lib/project-overview"
import type { ProjectReviewObjective } from "@/lib/project-review-objective"

type ObjectiveInput = { text: string; cohortId: string | null; revision: string | null }
type Value = {
  data: ProjectOverview | null
  loading: boolean
  error: string | null
  refresh: () => void
  saveObjective: (input: ObjectiveInput) => Promise<{ warning?: string }>
}
const Context = createContext<Value>({ data: null, loading: false, error: null, refresh: () => {}, saveObjective: async () => { throw new Error("Select a project first.") } })

export function ProjectOverviewProvider({ children }: { children: ReactNode }) {
  const { orgId } = useOrganisationSummary()
  const { project } = useOrganisationProject()
  const pathname = usePathname()
  const [token, setToken] = useState(0)
  const [result, setResult] = useState<{ scope: string; key: string; data?: ProjectOverview; error?: string } | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const scope = orgId && project ? `/api/admin/organisations/${orgId}/projects/${project.id}` : null
  const key = `${scope}|${pathname}|${token}`
  const refresh = useCallback(() => setToken((n) => n + 1), [])

  useEffect(() => {
    if (!scope) return
    const controller = new AbortController()
    controllerRef.current = controller
    fetch(`${scope}/overview`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The project overview could not be loaded.")
        if (!controller.signal.aborted) setResult({ scope, key, data: body as ProjectOverview })
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setResult((current) => ({ scope, key, data: current?.scope === scope ? current.data : undefined, error: error.message }))
      })
    return () => controller.abort()
  }, [scope, key])

  const saveObjective = useCallback(async (input: ObjectiveInput) => {
    if (!scope) throw new Error("Select a project first.")
    const response = await fetch(`${scope}/objective`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })
    const body = await response.json().catch(() => ({})) as { objective?: ProjectReviewObjective; error?: string; warning?: string }
    if (!response.ok || !body.objective) {
      if (response.status === 409) refresh()
      throw new Error(body.error ?? "The objective could not be saved.")
    }
    // An earlier overview request must not replace the brief that was just saved.
    controllerRef.current?.abort()
    setResult((current) => current?.scope === scope && current.data
      ? { ...current, error: undefined, data: { ...current.data, objective: body.objective! } } : current)
    refresh()
    return { warning: body.warning }
  }, [scope, refresh])
  const current = result?.scope === scope ? result : null
  return <Context.Provider value={{ data: current?.data ?? null, loading: Boolean(scope) && result?.key !== key, error: current?.error ?? null, refresh, saveObjective }}>{children}</Context.Provider>
}

export function useProjectOverview() { return useContext(Context) }
