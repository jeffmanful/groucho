import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import {
  applicationDecisionActor,
  parseHumanApplicationDecision,
} from "@/lib/application-decision"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requireOrgAdmin, unauthorized } from "@/lib/org-access"
import { isConcludedSessionStatus } from "@/lib/session-status"
import { supabase } from "@/lib/supabase"

const MAX_REASON_LENGTH = 1200

function advisoryRecommendationFromPayload(
  payload: unknown,
): "recommend" | "human_review" | "decline" | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null
  }
  const report = (payload as Record<string, unknown>).reviewer_report
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return null
  }
  const recommendation = (report as Record<string, unknown>)
    .advisory_recommendation
  return recommendation === "recommend" ||
    recommendation === "human_review" ||
    recommendation === "decline"
    ? recommendation
    : null
}

export async function POST(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ orgId: string; projectId: string; sessionId: string }>
  },
) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()

  const { orgId, projectId, sessionId } = await params
  const deny = await requireOrgAdmin(actor, orgId)
  if (deny) return deny

  let body: { decision?: unknown; reason?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const decision = parseHumanApplicationDecision(body.decision)
  if (!decision) {
    return NextResponse.json(
      { error: "decision must be approved or declined" },
      { status: 400 },
    )
  }

  const reason =
    typeof body.reason === "string"
      ? body.reason.trim().slice(0, MAX_REASON_LENGTH)
      : ""
  if (decision === "declined" && !reason) {
    return NextResponse.json(
      { error: "A reason is required when declining an application" },
      { status: 400 },
    )
  }

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, status")
    .eq("id", sessionId)
    .eq("project_id", projectId)
    .eq("organisation_id", orgId)
    .maybeSingle()

  if (sessionError || !session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  if (
    !isConcludedSessionStatus(session.status) ||
    session.status === "abandoned"
  ) {
    return NextResponse.json(
      { error: "Only completed applications can be reviewed" },
      { status: 409 },
    )
  }

  const { data: existing, error: existingError } = await supabase
    .from("application_decisions")
    .select("id, decision, created_at")
    .eq("session_id", sessionId)
    .maybeSingle()

  if (existingError) {
    console.error("application decision lookup:", existingError)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
  if (existing) {
    return NextResponse.json(
      { error: "A human decision has already been recorded", decision: existing },
      { status: 409 },
    )
  }

  const { data: verdict } = await supabase
    .from("verdicts")
    .select("payload")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  const advisoryRecommendation = advisoryRecommendationFromPayload(
    verdict?.payload,
  )
  const accessSecret = decision === "approved" ? randomUUID() : null

  const { data: recorded, error: insertError } = await supabase
    .from("application_decisions")
    .insert({
      organisation_id: orgId,
      project_id: projectId,
      session_id: sessionId,
      decision,
      advisory_recommendation: advisoryRecommendation,
      ...applicationDecisionActor(actor),
      reason: reason || null,
      access_secret: accessSecret,
    })
    .select(
      "id, decision, advisory_recommendation, reviewer_kind, reason, created_at",
    )
    .single()

  if (insertError || !recorded) {
    if (insertError?.code === "23505") {
      return NextResponse.json(
        { error: "A human decision has already been recorded" },
        { status: 409 },
      )
    }
    console.error("application decision insert:", insertError)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  return NextResponse.json({
    decision: recorded,
    reviewStatus: decision,
    ...(accessSecret ? { accessSecret } : {}),
  })
}
