import { NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { createApplicationInvitation } from "@/lib/application-invitations"
import { parseApplicantIdentity } from "@/lib/applicant-identity"
import { requireOrgAdmin, requireOrgMember, unauthorized } from "@/lib/org-access"
import { isSameOriginMutation } from "@/lib/platform-admin-access"
import { supabase } from "@/lib/supabase"

type Context = { params: Promise<{ orgId: string; projectId: string }> }
export async function GET(_req: Request, { params }: Context) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, projectId } = await params
  const deny = await requireOrgMember(actor, orgId)
  if (deny) return deny
  const { data: project, error: projectError } = await supabase.from("projects").select("settings").eq("id", projectId).eq("organisation_id", orgId).maybeSingle()
  if (projectError) return NextResponse.json({ error: "Project unavailable." }, { status: 503 })
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (project.settings?.application_invitation_required !== true) return NextResponse.json({ enabled: false, invitations: [] })
  const { data, error } = await supabase.from("application_invitations")
    .select("id, email, name, audience, expires_at, revoked_at, created_at")
    .eq("organisation_id", orgId).eq("project_id", projectId).order("created_at", { ascending: false }).limit(50)
  return error ? NextResponse.json({ error: "Invitations could not be loaded." }, { status: 503 }) : NextResponse.json({ enabled: true, invitations: data ?? [] }, { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(req: Request, { params }: Context) {
  if (!isSameOriginMutation(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, projectId } = await params
  const deny = await requireOrgAdmin(actor, orgId)
  if (deny) return deny
  const { data: project, error } = await supabase.from("projects").select("settings").eq("id", projectId).eq("organisation_id", orgId).maybeSingle()
  if (error) return NextResponse.json({ error: "Project unavailable." }, { status: 503 })
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (project.settings?.application_invitation_required !== true) return NextResponse.json({ error: "This project is not configured for invitation-only applications." }, { status: 409 })
  const body = await req.json().catch(() => null)
  const applicant = parseApplicantIdentity({ email: body?.email, name: body?.name || undefined })
  if (!applicant.ok || !applicant.value || !["community", "artist"].includes(body?.audience)) return NextResponse.json({ error: "Enter a valid email and application audience." }, { status: 400 })
  try {
    const url = new URL(project.settings?.application_url || "https://forum.colorsxstudios.com/apply")
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Invalid application URL")
    const created = await createApplicationInvitation({
      organisationId: orgId, projectId, email: applicant.value.email, name: applicant.value.name,
      audience: body.audience, actorEmail: actor.email, actorUserId: actor.kind === "member" ? actor.userId : null,
    })
    // A fragment keeps the bearer token out of HTTP URLs and Referer headers.
    url.hash = new URLSearchParams({ invite: created.token }).toString()
    return NextResponse.json({ invitation: created.invitation, url: url.href }, { status: 201, headers: { "Cache-Control": "private, no-store" } })
  } catch { return NextResponse.json({ error: "The invitation could not be created. Check the project's application URL." }, { status: 503 }) }
}

export async function DELETE(req: Request, { params }: Context) {
  if (!isSameOriginMutation(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const { orgId, projectId } = await params
  const deny = await requireOrgAdmin(actor, orgId)
  if (deny) return deny
  const body = await req.json().catch(() => null)
  if (typeof body?.id !== "string") return NextResponse.json({ error: "Invitation ID required" }, { status: 400 })
  const { data, error } = await supabase.from("application_invitations").update({ revoked_at: new Date().toISOString() })
    .eq("id", body.id).eq("project_id", projectId).eq("organisation_id", orgId).select("id").maybeSingle()
  if (error) return NextResponse.json({ error: "The invitation could not be revoked." }, { status: 503 })
  return data ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 })
}
