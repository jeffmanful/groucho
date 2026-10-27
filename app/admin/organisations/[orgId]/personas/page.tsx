"use client"

import { useParams } from "next/navigation"
import { OrgPersonasWorkspace } from "@/components/admin/personas/OrgPersonasWorkspace"

export default function OrganisationPersonasPage() {
  const params = useParams()
  return <OrgPersonasWorkspace orgId={params.orgId as string} />
}
