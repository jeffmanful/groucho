import { NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { unauthorized } from "@/lib/org-access"
import { buildOrganisationSummaries } from "@/lib/organisation-summary"

/** Every organisation the actor can open, with its projects and review workload. */
export async function GET() {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  try {
    return NextResponse.json({
      isPlatform: actor.kind === "platform",
      organisations: await buildOrganisationSummaries(actor),
    })
  } catch (error) {
    console.error("organisation summaries:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
