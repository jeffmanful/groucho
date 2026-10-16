"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { usePathname } from "next/navigation"
import type { AdminOverviewPayload } from "@/lib/admin-overview"

type Workspace = {
  data: AdminOverviewPayload | null
  loading: boolean
  error: string | null
  retry: () => void
}
const Context = createContext<Workspace | null>(null)
export function AdminWorkspaceProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [data, setData] = useState<AdminOverviewPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/admin/overview", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("The workspace could not be loaded. Try again.")
        const payload = (await response.json()) as AdminOverviewPayload
        if (controller.signal.aborted) return
        setData(payload)
        setLoading(false)
        setError(null)
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setError(
          error instanceof Error
            ? error.message
            : "The workspace could not be loaded.",
        )
        setLoading(false)
      })
    return () => controller.abort()
  }, [pathname, attempt])
  return (
    <Context.Provider
      value={{
        data,
        loading,
        error,
        retry: () => {
          setLoading(true)
          setError(null)
          setAttempt((n) => n + 1)
        },
      }}
    >
      {children}
    </Context.Provider>
  )
}
export function useAdminWorkspace() {
  const value = useContext(Context)
  if (!value) throw new Error("Admin workspace provider is missing")
  return value
}
