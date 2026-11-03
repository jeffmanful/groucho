import { redirect } from "next/navigation"

export default async function NeedsYouPage({ params, searchParams }: {
  params: Promise<{ orgId: string }>; searchParams: Promise<{ project?: string }>
}) {
  const { orgId } = await params
  const { project } = await searchParams
  const query = new URLSearchParams({ queue: "ready_for_review" })
  if (project) query.set("project", project)
  redirect(`/admin/organisations/${orgId}/applications?${query}`)
}
