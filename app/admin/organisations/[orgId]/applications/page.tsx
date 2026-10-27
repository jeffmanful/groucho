"use client"

import { useParams } from "next/navigation"
import { ApplicationsWorkspace } from "@/components/admin/applications/ApplicationsWorkspace"

export default function OrganisationApplicationsPage() {
  const params = useParams()
  return <ApplicationsWorkspace organisationId={params.orgId as string} />
}
