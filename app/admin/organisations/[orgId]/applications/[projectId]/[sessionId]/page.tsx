import { ApplicationDecision } from "@/components/admin/client/ApplicationDecision"

export default async function ApplicationPage({ params }: { params: Promise<{ projectId: string; sessionId: string }> }) {
  const { projectId, sessionId } = await params
  return <ApplicationDecision projectId={projectId} sessionId={sessionId} />
}
