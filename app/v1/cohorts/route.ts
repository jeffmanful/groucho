import { NextRequest, NextResponse } from "next/server"
import { resolveApplicationsKey } from "@/lib/api-key-scopes"
import { currentRound, listCohorts } from "@/lib/cohorts"

/** The current round's cohorts. */
export async function GET(req: NextRequest) {
  const key = await resolveApplicationsKey(req.headers.get("authorization"))
  if (!key.ok) return NextResponse.json({ error: key.error }, { status: key.status })
  try {
    const round = await currentRound(key.context.organisationId, key.context.projectId)
    const cohorts = await listCohorts(round.id)
    return NextResponse.json({
      round: { id: round.id, name: round.name, opensAt: round.opens_at, closesAt: round.closes_at },
      cohorts: cohorts.map((c) => ({
        id: c.id,
        name: c.name,
        grantsAccess: c.grantsAccess,
        capacity: c.capacity,
        members: c.members,
        locked: Boolean(c.lockedAt),
        drawnAt: c.drawnAt,
      })),
    })
  } catch (error) {
    const code = (error as { code?: string })?.code
    if (code === "42P01" || code === "PGRST205") return NextResponse.json({ error: "Cohorts need the latest database update." }, { status: 409 })
    console.error("v1 cohorts:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
