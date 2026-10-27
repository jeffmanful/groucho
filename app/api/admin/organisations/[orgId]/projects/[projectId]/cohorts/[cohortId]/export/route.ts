import { NextResponse } from "next/server"
import { projectRoute, serverError } from "@/lib/admin-project-route"
import { cohortCsv } from "@/lib/cohorts"
import { supabase } from "@/lib/supabase"

/** Everyone in the cohort, in order, as CSV: for running a ballot elsewhere or handing a list to your team. */
export async function GET(_req: Request, { params }: { params: Promise<{ orgId: string; projectId: string; cohortId: string }> }) {
  const route = await projectRoute(params, "member")
  if (!route.ok) return route.response
  const { cohortId } = await params
  const { data: cohort } = await supabase.from("cohorts").select("id, name").eq("id", cohortId).eq("project_id", route.value.projectId).maybeSingle()
  if (!cohort) return NextResponse.json({ error: "Not found" }, { status: 404 })
  try {
    const csv = await cohortCsv(cohortId)
    const slug = String(cohort.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cohort"
    return new NextResponse(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${slug}.csv"` },
    })
  } catch (error) {
    return serverError("cohort export:", error)
  }
}
