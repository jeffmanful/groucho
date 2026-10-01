import { NextRequest, NextResponse } from "next/server"
import { colorsDemoProject } from "@/lib/colors-demo-access"
import { demoSession } from "@/lib/colors-demo-token"
import { supabase } from "@/lib/supabase"

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId")?.trim() || ""
  if (!(await demoSession(req, sessionId))) {
    return NextResponse.json({ error: "Unauthorized demo session" }, { status: 401 })
  }
  const project = await colorsDemoProject()
  if (!project) return NextResponse.json({ error: "COLORS Forum demo is not configured" }, { status: 503 })
  const { data: session } = await supabase.from("sessions")
    .select("id, status, applicant_email")
    .eq("session_id", sessionId)
    .eq("project_id", project.context.projectId)
    .maybeSingle()
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 })
  const { data: lastAssistant } = await supabase.from("messages")
    .select("content, metadata")
    .eq("session_id", session.id)
    .eq("role", "assistant")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  const metadata = lastAssistant?.metadata && typeof lastAssistant.metadata === "object"
    ? lastAssistant.metadata as Record<string, unknown> : {}
  return NextResponse.json({
    status: session.status,
    applicantEmail: session.applicant_email,
    message: lastAssistant?.content ?? null,
    ui: metadata.ui ?? null,
  })
}
