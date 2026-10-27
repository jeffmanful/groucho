import { NextRequest, NextResponse } from "next/server"
import { projectRoute } from "@/lib/admin-project-route"
import { setLocked, updateCohort } from "@/lib/cohorts"

/** Body: { name?, capacity?, locked? }. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ orgId: string; projectId: string; cohortId: string }> }) {
  const route = await projectRoute(params, "admin")
  if (!route.ok) return route.response
  const { cohortId } = await params
  const body = (await req.json().catch(() => null)) as { name?: unknown; capacity?: unknown; locked?: unknown } | null
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  if (body.name !== undefined || body.capacity !== undefined) {
    const result = await updateCohort({
      projectId: route.value.projectId,
      cohortId,
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(body.capacity !== undefined ? { capacity: body.capacity === null || body.capacity === "" ? null : Number(body.capacity) } : {}),
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  }
  if (typeof body.locked === "boolean") {
    const result = await setLocked({ organisationId: route.value.orgId, projectId: route.value.projectId, cohortId, locked: body.locked, actor: route.value.allocationActor })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ ok: true })
}
