import { redirect } from "next/navigation"
import { adminRouteRedirect, type AdminSearchParams } from "@/lib/admin-route-redirect"

export default async function LegacyPage({ params, searchParams }: {
  params: Promise<{ orgId: string }>
  searchParams: Promise<AdminSearchParams>
}) {
  const [{ orgId }, search] = await Promise.all([params, searchParams])
  redirect(adminRouteRedirect(`/admin/organisations/${encodeURIComponent(orgId)}/integrations/conversations`, search))
}
