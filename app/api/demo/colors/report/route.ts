import { NextRequest, NextResponse } from "next/server"
import { colorsDemoProject } from "@/lib/colors-demo-access"
import { demoSession } from "@/lib/colors-demo-token"
import { generateDetailedReviewerReport } from "@/lib/detailed-reviewer-report"
import { getOrCreateRequestId } from "@/lib/request-trace"
import { normaliseReviewerReport } from "@/lib/reviewer-report"
import { supabase } from "@/lib/supabase"

type ReportMessage = {
  id: string
  role: string
  content: string
  metadata: unknown
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

async function load(req: NextRequest, sessionId: string) {
  if (!(await demoSession(req, sessionId))) return { error: "Unauthorized demo session", status: 401 } as const
  const project = await colorsDemoProject()
  if (!project) return { error: "COLORS Forum demo is not configured", status: 503 } as const
  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, status")
    .eq("session_id", sessionId)
    .eq("project_id", project.context.projectId)
    .maybeSingle()
  if (sessionError || !session) return { error: "Demo session not found", status: 404 } as const
  if (!(["passed", "redirected", "rejected"] as string[]).includes(session.status)) {
    return { error: "Conversation is still in progress", status: 409 } as const
  }
  const { data: messages, error: messagesError } = await supabase
    .from("messages")
    .select("id, role, content, metadata")
    .eq("session_id", session.id)
    .order("sent_at", { ascending: true })
  if (messagesError || !messages?.length) return { error: "Transcript unavailable", status: 503 } as const
  const rows = messages as ReportMessage[]
  const lastAssistant = [...rows].reverse().find((message) => message.role === "assistant")
  if (!lastAssistant) return { error: "Closing message unavailable", status: 503 } as const
  const metadata = record(lastAssistant.metadata)
  const baseReport = normaliseReviewerReport(metadata.reviewer_report)
  if (!baseReport) return { error: "Report evidence unavailable", status: 503 } as const
  return { session, project, rows, lastAssistant, metadata, baseReport } as const
}

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId")?.trim() || ""
  const loaded = await load(req, sessionId)
  if ("error" in loaded) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  const { metadata, baseReport } = loaded
  if (metadata.colors_demo_report_status === "ready" && baseReport.detailed_opinion) {
    return NextResponse.json({ status: "ready", report: baseReport })
  }
  if (metadata.colors_demo_report_status === "failed") {
    return NextResponse.json({ status: "failed", error: "The sample report could not be generated. You can retry it." })
  }
  return NextResponse.json({ status: "pending" })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : ""
  const loaded = await load(req, sessionId)
  if ("error" in loaded) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  const { session, project, rows, lastAssistant, metadata, baseReport } = loaded
  if (metadata.colors_demo_report_status === "ready" && baseReport.detailed_opinion) {
    return NextResponse.json({ status: "ready", report: baseReport })
  }
  const startedAt = typeof metadata.colors_demo_report_started_at === "number"
    ? metadata.colors_demo_report_started_at : 0
  if (metadata.colors_demo_report_status === "generating" && Date.now() - startedAt < 90_000) {
    return NextResponse.json({ status: "pending" }, { status: 202 })
  }
  const generatingMetadata = {
    ...metadata,
    colors_demo_report_status: "generating",
    colors_demo_report_started_at: Date.now(),
  }
  const { error: generatingError } = await supabase.from("messages")
    .update({ metadata: generatingMetadata })
    .eq("id", lastAssistant.id)
  if (generatingError) return NextResponse.json({ error: "Report status could not be saved" }, { status: 503 })
  try {
    const report = await generateDetailedReviewerReport({
      transcript: rows.filter((message): message is ReportMessage & { role: "user" | "assistant" } =>
        message.role === "user" || message.role === "assistant",
      ).map(({ id, role, content }) => ({ id, role, content })),
      baseReport,
      requestId: getOrCreateRequestId(req),
      organisationId: project.context.organisationId,
      projectId: project.context.projectId,
      sessionId,
      terminalStatus: session.status,
    })
    if (!report.detailed_opinion) throw new Error("Detailed report was empty")
    const { error } = await supabase.from("messages")
      .update({ metadata: {
        ...generatingMetadata,
        reviewer_report: report,
        colors_demo_report_status: "ready",
      } })
      .eq("id", lastAssistant.id)
    if (error) throw error
    return NextResponse.json({ status: "ready", report })
  } catch {
    await supabase.from("messages")
      .update({ metadata: {
        ...generatingMetadata,
        colors_demo_report_status: "failed",
      } })
      .eq("id", lastAssistant.id)
    return NextResponse.json({
      status: "failed",
      error: "The sample report could not be generated. You can retry it without repeating the conversation.",
    }, { status: 503 })
  }
}
