import { applicantIdentityFromRow } from "@/lib/applicant-identity"
import { NextRequest, NextResponse } from "next/server"
import { authorizeColorsDemo } from "@/lib/shared-colors-demo"
import { supabase } from "@/lib/supabase"

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("sessionId")?.trim() || ""
  const access = await authorizeColorsDemo(req, "session", clientId)
  if (access instanceof NextResponse) return access
  const { project, sessionId } = access
  const { data: session } = await supabase.from("sessions")
    .select("id, status, applicant_email, applicant_name, applicant_details, application_audience")
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
    applicant: applicantIdentityFromRow(session),
    message: lastAssistant?.content ?? null,
    ui: metadata.ui ?? null,
  })
}
