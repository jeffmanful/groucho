import { NextResponse } from "next/server"
import { buildAdminOverview } from "@/lib/admin-overview"
import { resolveAdminActor } from "@/lib/admin-actor"
import { unauthorized } from "@/lib/org-access"

export async function GET() {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()

  try {
    const payload = await buildAdminOverview(actor)
    return NextResponse.json(payload)
  } catch (err) {
    console.error("admin overview:", err)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
