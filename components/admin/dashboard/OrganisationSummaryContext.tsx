"use client"

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import type { OrganisationSummary } from "@/lib/organisation-summary"

type Value = {
  orgId: string | null
  summary: OrganisationSummary | null
  loading: boolean
  error: string | null
  refresh: () => void
}

const Context = createContext<Value>({ orgId: null, summary: null, loading: false, error: null, refresh: () => {} })

/** Loads the open organisation's summary once, for the sidebar counts and the organisation pages. */
export function OrganisationSummaryProvider({ orgId, children }: { orgId: string | null; children: ReactNode }) {
  const [token, setToken] = useState(0)
  const [result, setResult] = useState<{ key: string; summary?: OrganisationSummary; error?: string } | null>(null)
  const key = orgId ? `${orgId}|${token}` : null

  useEffect(() => {
    if (!key || !orgId) return
    const controller = new AbortController()
    fetch(`/api/admin/organisations/${orgId}/summary`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "This organisation could not be loaded.")
        setResult({ key, summary: body as OrganisationSummary })
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setResult({ key, error: error.message })
      })
    return () => controller.abort()
  }, [key, orgId])

  const refresh = useCallback(() => setToken((value) => value + 1), [])
  const current = result && orgId && result.key.startsWith(`${orgId}|`) ? result : null
  return (
    <Context.Provider
      value={{
        orgId,
        // Keep showing the last summary for this organisation while a refresh loads.
        summary: current?.summary ?? null,
        loading: Boolean(key) && result?.key !== key,
        error: current?.error ?? null,
        refresh,
      }}
    >
      {children}
    </Context.Provider>
  )
}

export function useOrganisationSummary(): Value {
  return useContext(Context)
}
