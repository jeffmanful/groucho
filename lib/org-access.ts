import { NextResponse } from "next/server"
import type { AdminActor } from "@/lib/admin-actor"
import { supabase } from "@/lib/supabase"

export type OrgRole = "owner" | "admin" | "member"

const RANK: Record<OrgRole, number> = { owner: 3, admin: 2, member: 1 }

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}

export function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 })
}

export function platformOnly() {
  return NextResponse.json({ error: "Platform admin only" }, { status: 403 })
}

export async function fetchOrgRole(userId: string, orgId: string): Promise<OrgRole | null> {
  const { data, error } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", orgId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error || !data?.role) return null
  const r = data.role as string
  if (r === "owner" || r === "admin" || r === "member") return r
  return null
}

function roleAtLeast(role: OrgRole | null, min: OrgRole): boolean {
  if (!role) return false
  return RANK[role] >= RANK[min]
}

/** Any accepted membership, or platform (no org check here — pass orgId separately). */
export async function requireOrgMember(
  actor: AdminActor,
  orgId: string,
): Promise<NextResponse | null> {
  if (actor.kind === "platform") return null
  const role = await fetchOrgRole(actor.userId, orgId)
  if (!roleAtLeast(role, "member")) return forbidden()
  return null
}

export async function requireOrgAdmin(
  actor: AdminActor,
  orgId: string,
): Promise<NextResponse | null> {
  if (actor.kind === "platform") return null
  const role = await fetchOrgRole(actor.userId, orgId)
  if (!roleAtLeast(role, "admin")) return forbidden()
  return null
}

export async function requireOrgOwner(
  actor: AdminActor,
  orgId: string,
): Promise<NextResponse | null> {
  if (actor.kind === "platform") return null
  const role = await fetchOrgRole(actor.userId, orgId)
  if (!roleAtLeast(role, "owner")) return forbidden()
  return null
}

export async function requirePlatform(actor: AdminActor): Promise<NextResponse | null> {
  if (actor.kind !== "platform") return platformOnly()
  return null
}

/** Personas list is needed for project wizard; restrict to platform or any org member. */
/** Organisation ids the actor may access (all orgs for platform). */
export async function listAccessibleOrgIds(actor: AdminActor): Promise<string[]> {
  if (actor.kind === "platform") {
    const { data, error } = await supabase
      .from("organisations")
      .select("id")
      .order("created_at", { ascending: true })
    if (error) throw error
    return (data ?? []).map((o) => o.id)
  }

  const { data, error } = await supabase
    .from("organisation_members")
    .select("organisation_id")
    .eq("user_id", actor.userId)

  if (error) throw error
  return [...new Set((data ?? []).map((m) => m.organisation_id))]
}

export async function requirePersonasReader(actor: AdminActor): Promise<NextResponse | null> {
  if (actor.kind === "platform") return null
  const { count, error } = await supabase
    .from("organisation_members")
    .select("*", { count: "exact", head: true })
    .eq("user_id", actor.userId)

  if (error) {
    console.error("org_members count:", error)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
  if (!count) return forbidden()
  return null
}
