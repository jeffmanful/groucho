// Shared checks for organisation project routes: signed in, allowed, and the project belongs to the organisation.
import { NextResponse } from "next/server"
import { resolveAdminActor, type AdminActor } from "@/lib/admin-actor"
import type { Actor } from "@/lib/cohorts"
import { requireOrgAdmin, requireOrgMember, unauthorized } from "@/lib/org-access"
import { supabase } from "@/lib/supabase"

export type ProjectRoute = { actor: AdminActor; orgId: string; projectId: string; allocationActor: Actor }

export async function projectRoute(
  params: Promise<{ orgId: string; projectId: string }>,
  level: "member" | "admin",
): Promise<{ ok: true; value: ProjectRoute } | { ok: false; response: NextResponse }> {
  const actor = await resolveAdminActor()
  if (!actor) return { ok: false, response: unauthorized() }
  const { orgId, projectId } = await params
  const deny = level === "admin" ? await requireOrgAdmin(actor, orgId) : await requireOrgMember(actor, orgId)
  if (deny) return { ok: false, response: deny }
  const { data: project, error } = await supabase.from("projects").select("id").eq("id", projectId).eq("organisation_id", orgId).maybeSingle()
  if (error?.code === "22P02" || (!error && !project)) return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  if (error) return { ok: false, response: NextResponse.json({ error: "Database error" }, { status: 500 }) }
  return {
    ok: true,
    value: {
      actor,
      orgId,
      projectId,
      allocationActor: actor.kind === "platform" ? { kind: "platform", email: actor.email } : { kind: "member", userId: actor.userId, email: actor.email },
    },
  }
}

export function serverError(label: string, error: unknown) {
  console.error(label, error)
  return NextResponse.json({ error: "Database error" }, { status: 500 })
}
