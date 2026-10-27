"use client"

import { useParams } from "next/navigation"
import { ProjectIntegrations } from "@/components/admin/dashboard/ProjectIntegrations"

export default function ProjectPage() {
  const params = useParams()
  return <ProjectIntegrations projectId={params.projectId as string} />
}
