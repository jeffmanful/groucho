import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requireOrgMember, unauthorized } from "@/lib/org-access"
import { supabase } from "@/lib/supabase"

const MAX_ROWS = 100

function hasExtractedProfile(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false
  const p = payload as Record<string, unknown>
  const profile = p.profile
  if (profile == null) return false
  if (typeof profile !== "object" || Array.isArray(profile)) return false
  return true
}

function normaliseEmbeddedSession(raw: unknown): {
  id: string
  session_id: string
  status: string
  created_at: string
  updated_at: string
  persona_id: string | null
} | null {
  if (!raw || typeof raw !== "object") return null
  if (Array.isArray(raw)) {
    const first = raw[0]
    if (!first || typeof first !== "object") return null
    return normaliseEmbeddedSession(first)
  }
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

/**
 * List sessions in a project that have an extracted profile on the verdict payload.
 * Used by the org admin UI “Extracted profiles” view.
 */
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

  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("organisation_id", orgId)
    .maybeSingle()

  if (pErr || !project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const { data: verdictRows, error: vErr } = await supabase
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

  if (vErr) {
    console.error("session-profiles verdicts:", vErr)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  const withProfile = (verdictRows ?? []).filter((row) => hasExtractedProfile(row.payload)).slice(0, MAX_ROWS)

  const personaIds = [
    ...new Set(
      withProfile
        .map((row) => {
          const s = normaliseEmbeddedSession(row.sessions)
          return s?.persona_id ?? null
        })
        .filter((id): id is string => Boolean(id)),
    ),
  ]

  const personaSchemaById = new Map<string, unknown>()
  if (personaIds.length > 0) {
    const { data: personas, error: pe } = await supabase
      .from("personas")
      .select("id, profile_schema")
      .in("id", personaIds)
    if (!pe && personas) {
      for (const p of personas) {
        if (p.id) personaSchemaById.set(p.id, p.profile_schema ?? null)
      }
    }
  }

  const rows: {
    session: NonNullable<ReturnType<typeof normaliseEmbeddedSession>>
    profile: unknown
    verdictCreatedAt: string
    personaSchema: unknown
  }[] = []

  for (const row of withProfile) {
    const session = normaliseEmbeddedSession(row.sessions)
    if (!session) continue
    const payload = row.payload as Record<string, unknown>
    rows.push({
      session,
      profile: payload.profile,
      verdictCreatedAt: row.created_at as string,
      personaSchema: session.persona_id
        ? (personaSchemaById.get(session.persona_id) ?? null)
        : null,
    })
  }

  return NextResponse.json({ rows })
}
