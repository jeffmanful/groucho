"use client"

import Link from "next/link"
import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAdminWorkspace } from "@/components/admin/AdminWorkspace"

/** Keep old conversation links working inside the organisation's shared project context. */
export default function AdminSessionsPage() {
  const { data, error } = useAdminWorkspace()
  const params = useSearchParams()
  const router = useRouter()
  const requested = params.get("project")
  const organisation = requested
    ? data?.organisations.find((org) => org.projects.some((project) => project.id === requested))
    : data?.organisations.length === 1 ? data.organisations[0] : null
  useEffect(() => {
    if (!organisation) return
    router.replace(`/admin/organisations/${organisation.id}/conversations${params.size ? `?${params}` : ""}`)
  }, [organisation, params, router])
  return <div style={{ padding: 32 }}>
    {error ? <p role="alert">{error}</p> : !data || organisation ? <p role="status">Opening conversations…</p> : <>
      <h1>{requested ? "Project unavailable" : "Choose an organisation"}</h1>
      <Link href="/admin">Open organisations</Link>
    </>}
  </div>
}
