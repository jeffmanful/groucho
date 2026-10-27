import { NextRequest, NextResponse } from "next/server"
import { projectRoute, serverError } from "@/lib/admin-project-route"
import { fillCohort, previewFill, sourcePage, type FillMode, type FillRequest } from "@/lib/cohorts"

const MODES: FillMode[] = ["everyone", "filter", "random", "score", "select"]

/**
 * Move people into a cohort. Body: { preview?, source: "unallocated" | cohortId | "any", target: cohortId | null,
 * mode, field?, values?, count?, sessionIds?, reason? }. With preview, nothing moves.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ orgId: string; projectId: string }> }) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const route = await projectRoute(params, body?.preview || body?.list ? "member" : "admin")
  if (!route.ok) return route.response
  if (!body || typeof body.source !== "string" || !MODES.includes(body.mode as FillMode)) {
    return NextResponse.json({ error: "source and mode are required" }, { status: 400 })
  }
  const request: FillRequest = {
    organisationId: route.value.orgId,
    projectId: route.value.projectId,
    source: body.source,
    target: typeof body.target === "string" ? body.target : null,
    mode: body.mode as FillMode,
    field: typeof body.field === "string" ? body.field : null,
    values: Array.isArray(body.values) ? body.values.filter((v): v is string => typeof v === "string") : [],
    count: typeof body.count === "number" ? body.count : null,
    sessionIds: Array.isArray(body.sessionIds) ? body.sessionIds.filter((v): v is string => typeof v === "string") : [],
    reason: typeof body.reason === "string" ? body.reason : null,
  }
  try {
    // { list: { offset, search } }: a page of the people in the source, to pick by hand. Nothing moves.
    if (body.list && typeof body.list === "object") {
      const list = body.list as { offset?: unknown; search?: unknown }
      return NextResponse.json(
        await sourcePage(request, {
          offset: Math.max(0, Number(list.offset) || 0),
          limit: 50,
          search: typeof list.search === "string" ? list.search : "",
        }),
      )
    }
    const result = body.preview ? await previewFill(request) : await fillCohort({ ...request, actor: route.value.allocationActor })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result)
  } catch (error) {
    if ((error as { code?: string })?.code === "22P02") return NextResponse.json({ error: "Not found" }, { status: 404 })
    return serverError("fill cohort:", error)
  }
}
