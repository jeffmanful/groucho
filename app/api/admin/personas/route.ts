import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requirePersonasReader, requirePlatform, unauthorized } from "@/lib/org-access"
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

  const { data, error } = await supabase
    .from("personas")
    .select("*")
    .order("created_at", { ascending: true })

  if (error) {
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  return NextResponse.json(data)
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
    })
    .select()
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

  invalidatePersonaCache()

  return NextResponse.json(data, { status: 201 })
}
