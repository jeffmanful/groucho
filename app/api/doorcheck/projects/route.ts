import { NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requirePersonasReader, unauthorized } from "@/lib/org-access"
import { listPlaygroundProjects } from "@/lib/playground-projects"

export async function GET() {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const deny = await requirePersonasReader(actor)
  if (deny) return deny

  try {
    const projects = await listPlaygroundProjects(actor)
    return NextResponse.json(projects)
  } catch (e) {
    console.error("doorcheck projects list:", e)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}
