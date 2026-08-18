import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requireOrgMember, unauthorized } from "@/lib/org-access"
import { supabase } from "@/lib/supabase"

const MAX_ROWS = 100

type SessionSummary = {
  id: string
  session_id: string
  status: string
  created_at: string
  updated_at: string
  persona_id: string | null
}

function hasExtractedProfile(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false
  const profile = (payload as Record<string, unknown>).profile
  return Boolean(profile && typeof profile === "object" && !Array.isArray(profile))
}

function normaliseEmbeddedSession(raw: unknown): SessionSummary | null {
  if (!raw || typeof raw !== "object") return null
  if (Array.isArray(raw)) return normaliseEmbeddedSession(raw[0])
  const s = raw as Record<string, unknown>
  if (typeof s.id !== "string" || typeof s.session_id !== "string") return null
  return {
    id: s.id,
    session_id: s.session_id,
    status: typeof s.status === "string" ? s.status : "",
    created_at: typeof s.created_at === "string" ? s.created_at : "",
    updated_at: typeof s.updated_at === "string" ? s.updated_at : "",
    persona_id: typeof s.persona_id === "string" ? s.persona_id : null,
  }
}

/** List session-level profiles, with verdict payloads as a historical fallback. */
export async function GET(
  _req: NextRequest,
  {
    params,
  }: { params: Promise<{ orgId: string; projectId: string }> },
) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, projectId } = await params
  const deny = await requireOrgMember(actor, orgId)
  if (deny) return deny

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("organisation_id", orgId)
    .maybeSingle()

  if (projectError || !project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const { data: sessionRows, error: sessionsError } = await supabase
    .from("sessions")
    .select(
      "id, session_id, status, created_at, updated_at, persona_id, profile, profile_extracted_at",
    )
    .eq("project_id", projectId)
    .eq("organisation_id", orgId)
    .not("profile", "is", null)
    .order("profile_extracted_at", { ascending: false, nullsFirst: false })
    .limit(MAX_ROWS)

  if (sessionsError) {
    console.error("session-profiles sessions:", sessionsError)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  const rowsBySession = new Map<
    string,
    {
      session: SessionSummary
      profile: unknown
      verdictCreatedAt: string
      personaSchema: unknown
    }
  >()

  for (const row of sessionRows ?? []) {
    rowsBySession.set(row.id, {
      session: {
        id: row.id,
        session_id: row.session_id,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
        persona_id: row.persona_id,
      },
      profile: row.profile,
      verdictCreatedAt: row.profile_extracted_at ?? row.updated_at,
      personaSchema: null,
    })
  }

  // Profiles generated before session-level storage remain visible.
  const { data: verdictRows, error: verdictsError } = await supabase
    .from("verdicts")
    .select(
      `
      created_at,
      payload,
      sessions (
        id,
        session_id,
        status,
        created_at,
        updated_at,
        persona_id
      )
    `,
    )
    .eq("project_id", projectId)
    .eq("organisation_id", orgId)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS * 2)

  if (verdictsError) {
    console.error("session-profiles verdicts:", verdictsError)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  for (const verdict of verdictRows ?? []) {
    if (!hasExtractedProfile(verdict.payload)) continue
    const session = normaliseEmbeddedSession(verdict.sessions)
    if (!session || rowsBySession.has(session.id)) continue
    const payload = verdict.payload as Record<string, unknown>
    rowsBySession.set(session.id, {
      session,
      profile: payload.profile,
      verdictCreatedAt: verdict.created_at as string,
      personaSchema: null,
    })
  }

  const rows = [...rowsBySession.values()]
    .sort((a, b) => b.verdictCreatedAt.localeCompare(a.verdictCreatedAt))
    .slice(0, MAX_ROWS)

  const personaIds = [
    ...new Set(
      rows
        .map((row) => row.session.persona_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  if (personaIds.length > 0) {
    const { data: personas } = await supabase
      .from("personas")
      .select("id, profile_schema")
      .in("id", personaIds)
    const schemaById = new Map(
      (personas ?? []).map((persona) => [persona.id, persona.profile_schema ?? null]),
    )
    for (const row of rows) {
      if (row.session.persona_id) {
        row.personaSchema = schemaById.get(row.session.persona_id) ?? null
      }
    }
  }

  return NextResponse.json({ rows })
}
