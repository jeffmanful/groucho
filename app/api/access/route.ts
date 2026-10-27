import { applicationAccess } from "@/lib/application-access"
import { NextRequest, NextResponse } from "next/server"
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

  const { granted: authorized } = await applicationAccess({ sessionId: data.id, projectId: project.projectId, secret })

  return NextResponse.json({ authorized })
}
