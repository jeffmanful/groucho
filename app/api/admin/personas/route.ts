import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { listAccessibleOrgIds, requirePersonasReader, requirePlatform, unauthorized } from "@/lib/org-access"
import { listPersonasVisibleToAny, PERSONA_RECORD_COLUMNS } from "@/lib/persona-ownership"
import { parsePersonaAccessInput, replacePersonaAccess } from "@/lib/persona-access-input"
import {
  normaliseExtractorHint,
  parseProfileSchemaInput,
} from "@/lib/persona-profile-schema"
import { supabase } from "@/lib/supabase"
import { invalidatePersonaCache } from "@/lib/persona-resolution"

export async function GET() {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const deny = await requirePersonasReader(actor)
  if (deny) return deny

  // Organisation members only see their organisations' personas and the Groucho personas visible to them.
  if (actor.kind !== "platform") {
    try {
      const personas = await listPersonasVisibleToAny(await listAccessibleOrgIds(actor))
      return NextResponse.json(personas.sort((a, b) => a.created_at.localeCompare(b.created_at)))
    } catch {
      return NextResponse.json({ error: "Database error" }, { status: 500 })
    }
  }

  const [{ data, error }, { data: access, error: accessError }] = await Promise.all([
    supabase.from("personas").select(PERSONA_RECORD_COLUMNS).order("created_at", { ascending: true }),
    supabase.from("persona_organisation_access").select("persona_id, organisation_id"),
  ])

  if (error || accessError) {
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  const accessByPersona = new Map<string, string[]>()
  for (const row of access ?? []) {
    accessByPersona.set(row.persona_id, [...(accessByPersona.get(row.persona_id) ?? []), row.organisation_id])
  }
  return NextResponse.json(
    (data ?? []).map((persona) => ({ ...persona, access_organisation_ids: accessByPersona.get(persona.id) ?? [] })),
  )
}

export async function POST(req: NextRequest) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const deny = await requirePlatform(actor)
  if (deny) return deny

  let body: {
    name: string
    slug: string
    prompt: string
    is_active: boolean
    is_default: boolean
    pass_threshold: number
    reject_threshold: number
    profile_schema?: unknown
    profile_extractor_hint?: unknown
    visibility?: unknown
    access_organisation_ids?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { name, slug, prompt, is_active, is_default, pass_threshold, reject_threshold } = body
  if (!name?.trim() || !slug?.trim() || !prompt?.trim()) {
    return NextResponse.json(
      { error: "Name, slug, and prompt are required." },
      { status: 400 },
    )
  }

  const parsedSchema = parseProfileSchemaInput(body.profile_schema)
  if (!parsedSchema.ok) {
    return NextResponse.json({ error: parsedSchema.error }, { status: 400 })
  }

  const access = parsePersonaAccessInput(body.visibility, body.access_organisation_ids)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: 400 })
  }

  if (is_default) {
    await supabase.from("personas").update({ is_default: false }).eq("is_default", true)
  }

  const { data, error } = await supabase
    .from("personas")
    .insert({
      name: name.trim(),
      slug: slug.trim(),
      prompt: prompt.trim(),
      is_active,
      is_default,
      pass_threshold: pass_threshold ?? 0.65,
      reject_threshold: reject_threshold ?? 0.25,
      profile_schema: parsedSchema.value,
      profile_extractor_hint: normaliseExtractorHint(body.profile_extractor_hint),
      visibility: access.visibility,
    })
    .select(PERSONA_RECORD_COLUMNS)
    .single()

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "A persona with that slug already exists." },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  if (access.organisationIds) {
    try {
      await replacePersonaAccess(data.id, access.organisationIds)
    } catch {
      return NextResponse.json({ error: "Persona saved, but its visibility could not be. Try saving again." }, { status: 500 })
    }
  }

  invalidatePersonaCache()

  return NextResponse.json({ ...data, access_organisation_ids: access.organisationIds ?? [] }, { status: 201 })
}
