import { NextRequest, NextResponse } from "next/server"
import { resolveApplicationsKey } from "@/lib/api-key-scopes"
import { countApplicationsByQueue, listApplications, parseApplicationQueueFilters } from "@/lib/application-queue"
import { parseClientDecisionPolicy } from "@/lib/decision-policy"
import { publicApplication } from "@/lib/public-application"
import { supabase } from "@/lib/supabase"

/**
 * Applications for the key's project, for a client's own review screens.
 * Query: queue (default ready_for_review), sort, q, audience, recommendation, from, to, limit (≤100), offset.
 * Requires an applications-scoped API key.
 */
export async function GET(req: NextRequest) {
  const key = await resolveApplicationsKey(req.headers.get("authorization"))
  if (!key.ok) return NextResponse.json({ error: key.error }, { status: key.status })
  const { organisationId, projectId } = key.context

  const { data: project } = await supabase.from("projects").select("settings").eq("id", projectId).maybeSingle()
  const policy = parseClientDecisionPolicy(project?.settings)
  const filters = parseApplicationQueueFilters(new URL(req.url).searchParams)
  try {
    const [{ rows, total }, counts] = await Promise.all([
      listApplications({ organisationId, projectId, filters }),
      countApplicationsByQueue({ organisationId, projectId, filters }),
    ])
    return NextResponse.json({
      applications: rows.map((row) => publicApplication(row, policy)),
      total,
      counts,
      offset: filters.offset,
      limit: filters.limit,
    })
  } catch (error) {
    console.error("v1 applications list:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
