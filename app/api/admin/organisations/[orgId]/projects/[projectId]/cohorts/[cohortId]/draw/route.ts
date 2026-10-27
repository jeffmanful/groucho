import { NextRequest, NextResponse } from "next/server"
import { projectRoute, serverError } from "@/lib/admin-project-route"
import { drawCohort } from "@/lib/cohorts"

/**
 * Draw winners from a locked cohort. Body: { targetId, restId?, count } or { targetId, restId?, byField, perValue }.
 * Runs once per cohort; Groucho records the input, the result and who ran it.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ orgId: string; projectId: string; cohortId: string }> }) {
  const route = await projectRoute(params, "admin")
  if (!route.ok) return route.response
  const { cohortId } = await params
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body.targetId !== "string") return NextResponse.json({ error: "targetId is required" }, { status: 400 })
  const perValue = body.perValue && typeof body.perValue === "object" && !Array.isArray(body.perValue)
    ? Object.fromEntries(Object.entries(body.perValue as Record<string, unknown>).map(([k, v]) => [k, Number(v)]))
    : undefined
  try {
    const result = await drawCohort({
      organisationId: route.value.orgId,
      projectId: route.value.projectId,
      sourceId: cohortId,
      targetId: body.targetId,
      restId: typeof body.restId === "string" ? body.restId : null,
      count: typeof body.count === "number" ? body.count : undefined,
      byField: typeof body.byField === "string" ? body.byField : null,
      perValue,
      actor: route.value.allocationActor,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result)
  } catch (error) {
    return serverError("draw:", error)
  }
}
