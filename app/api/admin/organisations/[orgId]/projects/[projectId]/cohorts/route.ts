import { NextRequest, NextResponse } from "next/server"
import { projectRoute, serverError } from "@/lib/admin-project-route"
import { cohortsOverview, createCohort } from "@/lib/cohorts"

/** The current round's cohorts, how many approved people aren't placed, and recent history. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ orgId: string; projectId: string }> }) {
  const route = await projectRoute(params, "member")
  if (!route.ok) return route.response
  try {
    return NextResponse.json(await cohortsOverview(route.value.orgId, route.value.projectId))
  } catch (error) {
    const code = (error as { code?: string })?.code
    if (code === "42P01" || code === "PGRST205" || code === "42703") {
      return NextResponse.json({ error: "Cohorts need the latest database update." }, { status: 409 })
    }
    return serverError("cohorts:", error)
  }
}

/** Body: { name, grantsAccess, capacity: number | null }. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ orgId: string; projectId: string }> }) {
  const route = await projectRoute(params, "admin")
  if (!route.ok) return route.response
  const body = (await req.json().catch(() => null)) as { name?: unknown; grantsAccess?: unknown; capacity?: unknown } | null
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  const result = await createCohort({
    organisationId: route.value.orgId,
    projectId: route.value.projectId,
    name: typeof body.name === "string" ? body.name : "",
    grantsAccess: body.grantsAccess === true,
    capacity: body.capacity === null || body.capacity === undefined || body.capacity === "" ? null : Number(body.capacity),
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.cohort, { status: 201 })
}
