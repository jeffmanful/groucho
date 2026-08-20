import { NextRequest, NextResponse } from "next/server"
import { humanDecisionGrantsAccess } from "@/lib/application-decision"
import { getDefaultProjectId } from "@/lib/project-resolution"
import { supabase } from "@/lib/supabase"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const sid = searchParams.get("sid")
  const secret = searchParams.get("secret")

  if (!sid?.trim() || !secret?.trim()) {
    return NextResponse.json({ authorized: false }, { status: 400 })
  }

  const project = await getDefaultProjectId()
  if (!project.ok) {
    return NextResponse.json({ authorized: false }, { status: 503 })
  }

  const { data } = await supabase
    .from("sessions")
    .select("id")
    .eq("session_id", sid)
    .eq("project_id", project.projectId)
    .maybeSingle()

  if (!data) {
    return NextResponse.json({ authorized: false })
  }

  const { data: decision } = await supabase
    .from("application_decisions")
    .select("decision, access_secret")
    .eq("session_id", data.id)
    .maybeSingle()

  const authorized = humanDecisionGrantsAccess(decision, secret)

  return NextResponse.json({ authorized })
}
