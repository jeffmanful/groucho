import { NextRequest, NextResponse } from "next/server"
import { projectRoute, serverError } from "@/lib/admin-project-route"
import { cohortBreakdown, cohortMembers } from "@/lib/cohorts"
import { supabase } from "@/lib/supabase"

export async function GET(req: NextRequest, { params }: { params: Promise<{ orgId: string; projectId: string; cohortId: string }> }) {
  const route = await projectRoute(params, "member")
  if (!route.ok) return route.response
  const { cohortId } = await params
  const { data: cohort } = await supabase.from("cohorts").select("id").eq("id", cohortId).eq("project_id", route.value.projectId).maybeSingle()
  if (!cohort) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const search = new URL(req.url).searchParams
  const offset = Math.max(0, Number.parseInt(search.get("offset") ?? "", 10) || 0)
  const breakdown = search.get("breakdown")
  try {
    // ?breakdown=size: member counts per value, for a draw by field.
    if (breakdown) {
      if (!/^[a-z][a-z0-9_]{0,39}$/i.test(breakdown)) return NextResponse.json({ error: "Unknown field" }, { status: 400 })
      return NextResponse.json({ breakdown: await cohortBreakdown(cohortId, breakdown) })
    }
    return NextResponse.json(await cohortMembers(cohortId, offset, 100))
  } catch (error) {
    return serverError("cohort members:", error)
  }
}
