"use client"

import { ProjectIntegrations } from "@/components/admin/dashboard/ProjectIntegrations"
import { useOrganisationProject } from "@/components/admin/dashboard/OrganisationProjectContext"

export default function IntegrationsPage() {
  const { project } = useOrganisationProject()
  return project ? <ProjectIntegrations key={project.id} projectId={project.id} /> : null
}
