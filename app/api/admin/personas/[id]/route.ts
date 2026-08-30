import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requirePlatform, unauthorized } from "@/lib/org-access"
import {
  normaliseExtractorHint,
  parseProfileSchemaInput,
} from "@/lib/persona-profile-schema"
import { supabase } from "@/lib/supabase"
import { invalidatePersonaCache } from "@/lib/persona-resolution"

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const deny = await requirePlatform(actor)
  if (deny) return deny

  const { id } = await params

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
      { status: 400 }
    )
  }

  const parsedSchema = parseProfileSchemaInput(body.profile_schema)
  if (!parsedSchema.ok) {
    return NextResponse.json({ error: parsedSchema.error }, { status: 400 })
  }

  if (is_default) {
    await supabase
      .from("personas")
      .update({ is_default: false })
      .eq("is_default", true)
      .neq("id", id)
  }

  const { data, error } = await supabase
    .from("personas")
    .update({
      name: name.trim(),
      slug: slug.trim(),
      prompt: prompt.trim(),
      is_active,
      is_default,
      pass_threshold: pass_threshold ?? 0.65,
      reject_threshold: reject_threshold ?? 0.25,
      profile_schema: parsedSchema.value,
      profile_extractor_hint: normaliseExtractorHint(body.profile_extractor_hint),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single()

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "A persona with that slug already exists." },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  invalidatePersonaCache(id)

  return NextResponse.json(data)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const deny = await requirePlatform(actor)
  if (deny) return deny

  const { id } = await params

  const { count } = await supabase
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("persona_id", id)

  if (count && count > 0) {
    return NextResponse.json(
      {
        error: `Cannot delete: this persona has ${count} associated session${count === 1 ? "" : "s"}.`,
      },
      { status: 409 }
    )
  }

  const { error } = await supabase.from("personas").delete().eq("id", id)

  if (error) {
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  invalidatePersonaCache(id)

  return NextResponse.json({ success: true })
}
