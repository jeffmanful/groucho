import { NextResponse } from "next/server"
import { projectRoute, serverError } from "@/lib/admin-project-route"
import { entryMatches } from "@/lib/entry-review"

/** The entries that share an email, phone or social account with this one. */
export async function GET(_req: Request, { params }: { params: Promise<{ orgId: string; projectId: string; sessionId: string }> }) {
  const route = await projectRoute(params, "member")
  if (!route.ok) return route.response
  const { sessionId } = await params
  try {
    return NextResponse.json({ groups: await entryMatches(route.value.orgId, route.value.projectId, sessionId) })
  } catch (error) {
    if ((error as { code?: string })?.code === "22P02") return NextResponse.json({ error: "Not found" }, { status: 404 })
    return serverError("entry matches:", error)
  }
}
