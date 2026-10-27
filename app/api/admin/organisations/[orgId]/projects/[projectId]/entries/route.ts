import { NextRequest, NextResponse } from "next/server"
import { projectRoute, serverError } from "@/lib/admin-project-route"
import { listEntries, parseEntryFilters } from "@/lib/entry-review"

/** Entries to review in bulk. Query: tab, noFlags, field, value (repeatable), conversation, q, offset, limit. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ orgId: string; projectId: string }> }) {
  const route = await projectRoute(params, "member")
  if (!route.ok) return route.response
  try {
    return NextResponse.json(await listEntries(route.value.orgId, route.value.projectId, parseEntryFilters(new URL(req.url).searchParams)))
  } catch (error) {
    const code = (error as { code?: string })?.code
    if (code === "42703") return NextResponse.json({ error: "Entries need the latest database update." }, { status: 409 })
    return serverError("entries:", error)
  }
}
