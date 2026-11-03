"use client"

import { useOrganisationSummary } from "@/components/admin/dashboard/OrganisationSummaryContext"
import { useOrganisationProject } from "@/components/admin/dashboard/OrganisationProjectContext"

export function useDropProject() {
  const { orgId, summary } = useOrganisationSummary()
  const { project, projects, choose } = useOrganisationProject()
  return { orgId, summary, projects, project, choose, canManage: summary?.canManage ?? false }
}

export const nf = new Intl.NumberFormat("en-GB")

/** "Size", "Shoe size" from `size`, `shoe_size`. */
export function fieldLabel(key: string): string {
  const text = key.replace(/_/g, " ")
  return text.charAt(0).toUpperCase() + text.slice(1)
}
