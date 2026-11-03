import { NextResponse } from "next/server"
import { projectRoute, serverError } from "@/lib/admin-project-route"
import { buildProjectOverview } from "@/lib/project-overview"

export async function GET(_req: Request, { params }: { params: Promise<{ orgId: string; projectId: string }> }) {
  const route = await projectRoute(params, "member")
  if (!route.ok) return route.response
  try {
    return NextResponse.json(await buildProjectOverview(route.value.orgId, route.value.projectId))
  } catch (error) { return serverError("project overview:", error) }
}
