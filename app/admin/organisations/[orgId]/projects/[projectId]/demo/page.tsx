import { ProjectDemoLinks } from "@/components/admin/dashboard/ProjectDemoLinks"

export default async function ProjectDemoSettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  return <ProjectDemoLinks key={projectId} projectId={projectId} />
}
