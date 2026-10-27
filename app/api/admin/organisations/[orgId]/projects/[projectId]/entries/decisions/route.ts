import { NextRequest, NextResponse } from "next/server"
import { projectRoute, serverError } from "@/lib/admin-project-route"
import { bulkDecide, matchingEntryIds, parseEntryFilters } from "@/lib/entry-review"

/**
 * Approve or decline many entries. Body: { decision, reason?, applicantReason?, sessionIds? , filters? }.
 * With filters (the list's query string), every matching entry is included, up to 10,000.
 * Flagged entries are never approved in bulk.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ orgId: string; projectId: string }> }) {
  const route = await projectRoute(params, "admin")
  if (!route.ok) return route.response
  const { orgId, projectId, actor } = route.value
  const body = (await req.json().catch(() => null)) as {
    decision?: unknown
    reason?: unknown
    applicantReason?: unknown
    sessionIds?: unknown
    filters?: unknown
  } | null
  if (!body || (body.decision !== "approved" && body.decision !== "declined")) {
    return NextResponse.json({ error: "decision must be approved or declined" }, { status: 400 })
  }
  try {
    let ids: string[]
    if (typeof body.filters === "string") {
      const filters = parseEntryFilters(new URLSearchParams(body.filters))
      if (body.decision === "approved") {
        if (filters.tab === "flagged") return NextResponse.json({ error: "Flagged entries are resolved one group at a time" }, { status: 400 })
        filters.noFlags = true
      }
      ids = (await matchingEntryIds(orgId, projectId, filters)).ids
    } else if (Array.isArray(body.sessionIds) && body.sessionIds.every((id) => typeof id === "string")) {
      ids = body.sessionIds as string[]
      if (body.decision === "approved") {
        // Never approve flagged entries in bulk, even when picked by hand: resolve them one by one.
        const flagged = new Set((await matchingEntryIds(orgId, projectId, { ...parseEntryFilters(new URLSearchParams("tab=flagged")) })).ids)
        ids = ids.filter((id) => !flagged.has(id))
      }
    } else {
      return NextResponse.json({ error: "Send sessionIds or filters" }, { status: 400 })
    }
    if (!ids.length) return NextResponse.json({ error: "No entries to update" }, { status: 400 })
    const result = await bulkDecide({
      organisationId: orgId,
      projectId,
      sessionIds: ids,
      decision: body.decision,
      reason: typeof body.reason === "string" ? body.reason : "",
      applicantReason: typeof body.applicantReason === "string" ? body.applicantReason : null,
      reviewer: actor.kind === "platform" ? { kind: "platform", email: actor.email } : { kind: "member", userId: actor.userId, email: actor.email },
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result)
  } catch (error) {
    return serverError("bulk decisions:", error)
  }
}
