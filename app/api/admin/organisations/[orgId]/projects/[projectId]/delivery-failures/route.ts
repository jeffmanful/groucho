import { NextResponse } from "next/server"
import { projectRoute, serverError } from "@/lib/admin-project-route"
import { failedDeliveries } from "@/lib/needs-you"

export async function GET(_req: Request, { params }: { params: Promise<{ orgId: string; projectId: string }> }) {
  const route = await projectRoute(params, "member")
  if (!route.ok) return route.response
  try {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
    return NextResponse.json({ deliveries: await failedDeliveries([route.value.projectId], since) })
  } catch (error) {
    return serverError("delivery failures:", error)
  }
}
