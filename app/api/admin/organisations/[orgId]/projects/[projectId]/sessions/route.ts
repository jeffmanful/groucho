import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requireOrgMember, unauthorized } from "@/lib/org-access"
import { supabase } from "@/lib/supabase"
import { applicationReviewStatus } from "@/lib/application-decision"
import { parseClientDecisionPolicy, suitabilityBand } from "@/lib/decision-policy"
import { isConcludedSessionStatus } from "@/lib/session-status"

const PAGE_SIZE = 50

type DatabaseError = {
  code?: string | null
  message?: string | null
}

type SessionListRow = {
  id: string
  session_id: string
  status: string
  persona_id: string | null
  created_at: string
  updated_at: string
  profile_extracted_at: string | null
  applicant_email: string | null
  applicant_name: string | null
  suitability_score: number | null
}

type DecisionListRow = {
  session_id: string
  decision: string
  decision_source: "human" | "policy" | null
}

function isMissingSchemaPart(
  error: DatabaseError | null,
  part: string,
): boolean {
  if (!error) return false
  const missingSchemaCodes = new Set(["42703", "42P01", "PGRST204", "PGRST205"])
  return (
    missingSchemaCodes.has(error.code ?? "") &&
    (error.message ?? "").toLowerCase().includes(part.toLowerCase())
  )
}

export async function GET(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ orgId: string; projectId: string }> },
) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, projectId } = await params
  const deny = await requireOrgMember(actor, orgId)
  if (deny) return deny

  const { searchParams } = new URL(req.url)
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0)

  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("id, settings")
    .eq("id", projectId)
    .eq("organisation_id", orgId)
    .maybeSingle()

  if (pErr || !project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const sessionResult = await supabase
    .from("sessions")
    .select(
      "id, session_id, status, persona_id, created_at, updated_at, profile_extracted_at, applicant_email, applicant_name, suitability_score",
      { count: "exact" },
    )
    .eq("project_id", projectId)
    .order("suitability_score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  let data = sessionResult.data as SessionListRow[] | null
  let error = sessionResult.error
  let count = sessionResult.count
  const legacySuitabilitySchema = isMissingSchemaPart(error, "suitability_score")

  if (legacySuitabilitySchema) {
    console.warn(
      "sessions list: decision-policy migration is not applied; loading without suitability scores",
    )
    const legacyResult = await supabase
      .from("sessions")
      .select(
        "id, session_id, status, persona_id, created_at, updated_at, profile_extracted_at, applicant_email, applicant_name",
        { count: "exact" },
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)
    data = (legacyResult.data ?? []).map((session) => ({
      ...session,
      suitability_score: null,
    })) as SessionListRow[]
    error = legacyResult.error
    count = legacyResult.count
  }

  if (error) {
    console.error("sessions list:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  const focusSessionId = searchParams.get("session")?.trim()
  if (
    focusSessionId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(focusSessionId) &&
    !(data ?? []).some((session) => session.id === focusSessionId)
  ) {
    const focusResult = await supabase
      .from("sessions")
      .select(legacySuitabilitySchema
        ? "id, session_id, status, persona_id, created_at, updated_at, profile_extracted_at, applicant_email, applicant_name"
        : "id, session_id, status, persona_id, created_at, updated_at, profile_extracted_at, applicant_email, applicant_name, suitability_score")
      .eq("id", focusSessionId)
      .eq("project_id", projectId)
      .eq("organisation_id", orgId)
      .maybeSingle()
    if (focusResult.error) {
      console.error("focused session:", focusResult.error)
      return NextResponse.json({ error: "Database error" }, { status: 500 })
    }
    const focusedSession = focusResult.data as unknown as SessionListRow | null
    if (focusedSession) {
      data = [{
        ...focusedSession,
        suitability_score: legacySuitabilitySchema
          ? null
          : focusedSession.suitability_score,
      } as SessionListRow, ...(data ?? [])]
    }
  }

  const sessionIds = (data ?? []).map((session) => session.id)
  let decisions: DecisionListRow[] = []
  let decisionsError: DatabaseError | null = null
  if (sessionIds.length) {
    const decisionResult = await supabase
      .from("application_decisions")
      .select("session_id, decision, decision_source")
      .in("session_id", sessionIds)
    decisions = (decisionResult.data ?? []) as DecisionListRow[]
    decisionsError = decisionResult.error

    if (isMissingSchemaPart(decisionsError, "decision_source")) {
      console.warn(
        "sessions list: decision-policy migration is not applied; treating existing decisions as human",
      )
      const legacyDecisionResult = await supabase
        .from("application_decisions")
        .select("session_id, decision")
        .in("session_id", sessionIds)
      decisions = (legacyDecisionResult.data ?? []).map((decision) => ({
        ...decision,
        decision_source: "human" as const,
      })) as DecisionListRow[]
      decisionsError = legacyDecisionResult.error
    }

    if (isMissingSchemaPart(decisionsError, "application_decisions")) {
      console.warn(
        "sessions list: application decisions are not available; loading sessions as pending review",
      )
      decisions = []
      decisionsError = null
    }
  }
  if (decisionsError) {
    console.error("sessions decisions:", decisionsError)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  const decisionBySession = new Map(
    (decisions ?? []).map((decision) => [decision.session_id, decision]),
  )
  const policy = parseClientDecisionPolicy(project.settings)
  const sessions = (data ?? []).map((session) => {
    const decision = decisionBySession.get(session.id)
    const score =
      typeof session.suitability_score === "number"
        ? session.suitability_score
        : null
    return {
      ...session,
      review_status: applicationReviewStatus({
        concluded: isConcludedSessionStatus(session.status),
        decision,
      }),
      decision_source: decision?.decision_source ?? null,
      suitability_band: score === null ? null : suitabilityBand(score, policy),
    }
  })

  return NextResponse.json({
    sessions,
    total: count ?? 0,
    offset,
    limit: PAGE_SIZE,
  })
}
