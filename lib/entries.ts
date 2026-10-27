// Entries submitted without a conversation (drops): name, email, phone, socials and drop fields.
import { normaliseApplicantEmail } from "@/lib/applicant-identity"
import { supabase } from "@/lib/supabase"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_FIELDS = 20
const MAX_SOCIALS = 8

export type EntryInput = {
  email: string
  name: string | null
  phone: string | null
  socials: string[]
  fields: Record<string, string>
}

/** Validates an entry body: { applicant: { email, name }, phone?, socials?, fields? }. */
export function parseEntryInput(body: unknown): { ok: true; value: EntryInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid JSON" }
  const b = body as Record<string, unknown>
  const applicant = (b.applicant && typeof b.applicant === "object" ? b.applicant : {}) as Record<string, unknown>
  const email = typeof applicant.email === "string" ? normaliseApplicantEmail(applicant.email) : ""
  if (!email || email.length > 320 || !EMAIL_RE.test(email)) return { ok: false, error: "applicant.email must be a valid email" }
  const name = typeof applicant.name === "string" ? applicant.name.trim().slice(0, 160) : ""

  let phone: string | null = null
  if (b.phone !== undefined && b.phone !== null && b.phone !== "") {
    if (typeof b.phone !== "string" || b.phone.length > 40 || !/^[+\d\s().-]+$/.test(b.phone)) {
      return { ok: false, error: "phone must be a phone number" }
    }
    phone = b.phone.trim()
  }

  let socials: string[] = []
  if (b.socials !== undefined) {
    if (!Array.isArray(b.socials) || b.socials.length > MAX_SOCIALS) {
      return { ok: false, error: `socials must be a list of up to ${MAX_SOCIALS} links or handles` }
    }
    socials = [...new Set(b.socials.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean))]
    if (socials.some((item) => item.length > 300)) return { ok: false, error: "Each social link must be 300 characters or fewer" }
  }

  const fields: Record<string, string> = {}
  if (b.fields !== undefined) {
    if (!b.fields || typeof b.fields !== "object" || Array.isArray(b.fields)) return { ok: false, error: "fields must be an object" }
    const entries = Object.entries(b.fields as Record<string, unknown>)
    if (entries.length > MAX_FIELDS) return { ok: false, error: `fields can have up to ${MAX_FIELDS} entries` }
    for (const [key, value] of entries) {
      if (!/^[a-z][a-z0-9_]{0,39}$/i.test(key)) return { ok: false, error: `Field names use letters, numbers and underscores: ${key}` }
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        return { ok: false, error: `fields.${key} must be text, a number or true/false` }
      }
      const text = String(value).trim()
      if (text.length > 200) return { ok: false, error: `fields.${key} must be 200 characters or fewer` }
      if (text) fields[key] = text
    }
  }
  return { ok: true, value: { email, name: name || null, phone, socials, fields } }
}

export type EntryResult =
  | { ok: true; id: string; created: boolean }
  | { ok: false; status: number; error: string }

/** Records an entry. Entering twice with the same session key returns the first entry. */
export async function createEntry(input: {
  organisationId: string
  projectId: string
  clientSessionKey: string
  entry: EntryInput
}): Promise<EntryResult> {
  const round = await currentRoundWindow(input.projectId)
  const now = Date.now()
  if (round?.opens_at && Date.parse(round.opens_at) > now) return { ok: false, status: 409, error: "Entries are not open yet" }
  if (round?.closes_at && Date.parse(round.closes_at) <= now) return { ok: false, status: 409, error: "Entries are closed" }

  const { data, error } = await supabase
    .from("sessions")
    .insert({
      organisation_id: input.organisationId,
      project_id: input.projectId,
      session_id: input.clientSessionKey,
      status: "completed",
      entry_kind: "form",
      applicant_email: input.entry.email,
      ...(input.entry.name ? { applicant_name: input.entry.name } : {}),
      entry: {
        ...(input.entry.phone ? { phone: input.entry.phone } : {}),
        socials: input.entry.socials,
        fields: input.entry.fields,
      },
    })
    .select("id")
    .single()
  if (error?.code === "23505") {
    const { data: existing } = await supabase
      .from("sessions")
      .select("id, entry_kind")
      .eq("project_id", input.projectId)
      .eq("session_id", input.clientSessionKey)
      .maybeSingle()
    if (existing?.entry_kind === "form") return { ok: true, id: existing.id as string, created: false }
    return { ok: false, status: 409, error: "This session key is already in use" }
  }
  if (error?.code === "42703" || error?.code === "PGRST204") {
    return { ok: false, status: 409, error: "Entries need the latest database update." }
  }
  if (error || !data) {
    console.error("entry insert:", error)
    return { ok: false, status: 500, error: "Database error" }
  }
  return { ok: true, id: data.id as string, created: true }
}

async function currentRoundWindow(projectId: string): Promise<{ opens_at: string | null; closes_at: string | null } | null> {
  const { data, error } = await supabase
    .from("allocation_rounds")
    .select("opens_at, closes_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  return (data as { opens_at: string | null; closes_at: string | null } | null) ?? null
}
