"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useOrganisationSummary } from "@/components/admin/dashboard/OrganisationSummaryContext"
import styles from "./drops.module.css"

/** The project these screens are showing: `?project=`, else the first active project. */
export function useDropProject() {
  const { orgId, summary } = useOrganisationSummary()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const projects = (summary?.projects ?? []).filter((project) => !project.archived && project.projectType !== "ticket_access")
  const wanted = params.get("project")
  const project = projects.find((p) => p.id === wanted) ?? projects[0] ?? null
  function choose(id: string) {
    const next = new URLSearchParams(params.toString())
    next.set("project", id)
    router.replace(`${pathname}?${next}`)
  }
  return { orgId, summary, projects, project, choose, canManage: summary?.canManage ?? false }
}

export function ProjectSwitch({ projects, value, onChange }: { projects: Array<{ id: string; name: string }>; value: string; onChange: (id: string) => void }) {
  if (projects.length < 2) return <span>{projects[0]?.name}</span>
  return (
    <select className={styles.projectSelect} value={value} onChange={(event) => onChange(event.target.value)} aria-label="Project">
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name}
        </option>
      ))}
    </select>
  )
}

export const nf = new Intl.NumberFormat("en-GB")

/** "Size", "Shoe size" from `size`, `shoe_size`. */
export function fieldLabel(key: string): string {
  const text = key.replace(/_/g, " ")
  return text.charAt(0).toUpperCase() + text.slice(1)
}
