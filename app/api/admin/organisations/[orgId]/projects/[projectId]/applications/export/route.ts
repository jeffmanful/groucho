import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import {
  applicationsCsv,
  listApplications,
  MAX_EXPORT_ROWS,
  parseApplicationQueueFilters,
  withBand,
} from "@/lib/application-queue"
import { parseClientDecisionPolicy } from "@/lib/decision-policy"
import { requireOrgMember, unauthorized } from "@/lib/org-access"
import { supabase } from "@/lib/supabase"

/** CSV of every application matching the current filters (up to MAX_EXPORT_ROWS). */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string; projectId: string }> },
) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, projectId } = await params
  const deny = await requireOrgMember(actor, orgId)
  if (deny) return deny

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, slug, settings")
    .eq("id", projectId)
    .eq("organisation_id", orgId)
    .maybeSingle()
  if (projectError || !project) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const search = new URL(req.url).searchParams
  const filters = { ...withBand(parseApplicationQueueFilters(search), search.get("band"), parseClientDecisionPolicy(project.settings)), offset: 0 }
  try {
    const rows = []
    for (let offset = 0; offset < MAX_EXPORT_ROWS; offset += 1000) {
      const page = await listApplications({ organisationId: orgId, projectId, filters: { ...filters, offset }, limit: 1000 })
      rows.push(...page.rows)
      if (page.rows.length < 1000) break
    }
    const date = new Date().toISOString().slice(0, 10)
    return new NextResponse(applicationsCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${project.slug}-applications-${filters.queue}-${date}.csv"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("application export:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
