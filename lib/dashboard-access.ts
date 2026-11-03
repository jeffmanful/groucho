import { createHash } from "node:crypto"
import { hasManagedPlatformAccess } from "@/lib/platform-admin-access"
import { safeAuthPath } from "@/lib/auth-redirect"
import { supabase } from "@/lib/supabase"

export type DashboardUser = {
  id: string
  email?: string | null
  email_confirmed_at?: string | null
  app_metadata?: Record<string, unknown>
}

/** Identity alone never grants access. Memberships and platform grants are server-managed. */
export async function dashboardAccess(user: DashboardUser): Promise<"platform" | "member" | null> {
  if (!user.email || !user.email_confirmed_at) return null
  if (user.app_metadata?.groucho_role === "platform_admin" ||
    await hasManagedPlatformAccess(user.id, user.email)) return "platform"
  const { data, error } = await supabase.from("organisation_members")
    .select("id").eq("user_id", user.id).in("role", ["owner", "admin", "member"]).limit(1)
  return !error && data?.length ? "member" : null
}

export const validOrganisationInviteToken = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value)

/** Also used before email delivery, so the browser cannot choose a recipient. */
export async function pendingOrganisationInvitation(token: unknown) {
  if (!validOrganisationInviteToken(token)) return null
  const { data, error } = await supabase.from("invitations")
    .select("id, organisation_id, email, role, expires_at, accepted_at")
    .eq("token", token).is("accepted_at", null).gt("expires_at", new Date().toISOString()).maybeSingle()
  return !error && data && ["owner", "admin", "member"].includes(data.role) ? data : null
}

/** Pending invitations permit sign-in only to their exact acceptance page, never the dashboard. */
export async function canSignInToDashboard(user: DashboardUser, next: string | null | undefined) {
  if (!user.email || !user.email_confirmed_at) return false
  if (await dashboardAccess(user)) return true
  const path = new URL(safeAuthPath(next), "https://groucho.invalid").pathname
  const match = /^\/invite\/(admin\/)?([a-f0-9]{64})$/.exec(path)
  if (!match) return false
  if (!match[1]) {
    const invitation = await pendingOrganisationInvitation(match[2])
    return invitation?.email.toLowerCase() === user.email.toLowerCase()
  }
  const { data, error } = await supabase.from("platform_admin_access")
    .select("email").eq("token_hash", createHash("sha256").update(match[2]).digest("hex"))
    .eq("status", "pending").gt("expires_at", new Date().toISOString()).maybeSingle()
  return !error && data?.email.toLowerCase() === user.email.toLowerCase()
}
