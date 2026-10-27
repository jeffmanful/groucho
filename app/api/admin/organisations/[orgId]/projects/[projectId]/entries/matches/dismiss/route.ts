import { NextRequest, NextResponse } from "next/server"
import { projectRoute } from "@/lib/admin-project-route"
import { dismissMatch } from "@/lib/entry-review"

/** "Not duplicates": the match stops flagging anyone. Body: { token, reason? }. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ orgId: string; projectId: string }> }) {
  const route = await projectRoute(params, "admin")
  if (!route.ok) return route.response
  const body = (await req.json().catch(() => null)) as { token?: unknown; reason?: unknown } | null
  if (typeof body?.token !== "string") return NextResponse.json({ error: "token is required" }, { status: 400 })
  const result = await dismissMatch({
    projectId: route.value.projectId,
    token: body.token,
    reason: typeof body.reason === "string" ? body.reason : "",
    email: route.value.actor.email,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true })
}
