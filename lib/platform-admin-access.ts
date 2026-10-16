import { authRequestOrigin } from "@/lib/auth-redirect"
import { createHash, randomBytes } from "node:crypto"
import { supabase } from "@/lib/supabase"
import { isAllowedPlatformEmail } from "@/lib/pe-auth"

export const ADMIN_INVITE_DAYS = 7
export type AdminAccessRow = {
  id: string
  email: string
  user_id: string | null
  status: "pending" | "active" | "revoked"
  invited_by: string
  invited_at: string
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
  revoked_by: string | null
}
export const ACCESS_FIELDS =
  "id,email,user_id,status,invited_by,invited_at,expires_at,accepted_at,revoked_at,revoked_by"
export function inviteHash(token: string) {
  return createHash("sha256").update(token).digest("hex")
}
export function validInviteToken(token: unknown): token is string {
  return typeof token === "string" && /^[a-f0-9]{64}$/.test(token)
}
export function accessStatus(
  row: Pick<AdminAccessRow, "status" | "expires_at">,
  now = Date.now(),
) {
  return row.status === "pending" && Date.parse(row.expires_at) <= now
    ? "expired"
    : row.status
}
export function verifiedInviteEmail(
  user: { email?: string; email_confirmed_at?: string },
  email: string,
) {
  return Boolean(user.email_confirmed_at && user.email?.toLowerCase() === email)
}
export async function hasManagedPlatformAccess(userId: string, email: string) {
  const { data, error } = await supabase
    .from("platform_admin_access")
    .select("id")
    .eq("user_id", userId)
    .eq("email", email.toLowerCase())
    .eq("status", "active")
    .maybeSingle()
  // Fail closed on unavailable access storage; core administrators use trusted metadata.
  return !error && Boolean(data)
}
export async function protectedAdmins() {
  const emails = new Map<string, string>()
  for (const email of (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())) {
    if (email && isAllowedPlatformEmail(email))
      emails.set(email, "Legacy operator")
  }
  // Supabase paginates this API; never assume all administrators fit on one page.
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 100,
    })
    if (error) throw error
    for (const user of data.users) {
      if (
        user.email &&
        user.email_confirmed_at &&
        user.app_metadata?.groucho_role === "platform_admin"
      )
        emails.set(user.email.toLowerCase(), "Core administrator")
    }
    if (data.users.length < 100) break
  }
  return [...emails].map(([email, source]) => ({
    id: `${source === "Core administrator" ? "protected" : "legacy"}:${email}`,
    email,
    status: "active" as const,
    source,
    protected: source === "Core administrator",
  }))
}
export async function issueAdminInvite(email: string, invitedBy: string) {
  const token = randomBytes(32).toString("hex")
  const now = new Date()
  const values = {
    email,
    invited_by: invitedBy,
    invited_at: now.toISOString(),
    expires_at: new Date(
      now.getTime() + ADMIN_INVITE_DAYS * 86400000,
    ).toISOString(),
    token_hash: inviteHash(token),
    status: "pending",
    user_id: null,
    accepted_at: null,
    revoked_at: null,
    revoked_by: null,
  }
  const { data: existing, error: readError } = await supabase
    .from("platform_admin_access")
    .select("id,status")
    .eq("email", email)
    .maybeSingle()
  if (readError) throw readError
  if (existing?.status === "active") return { conflict: true as const }
  // Conditional update prevents a concurrent acceptance being overwritten by a resend.
  const query = existing
    ? supabase
        .from("platform_admin_access")
        .update(values)
        .eq("id", existing.id)
        .neq("status", "active")
    : supabase.from("platform_admin_access").insert(values)
  const { data, error } = await query.select(ACCESS_FIELDS).maybeSingle()
  if (error) {
    if (error.code === "23505") return { conflict: true as const }
    throw error
  }
  if (!data) return { conflict: true as const }
  return { conflict: false as const, invitation: data as AdminAccessRow, token }
}

export function isSameOriginMutation(request: Request) {
  const origin = request.headers.get("origin")
  if (!origin) return true // Non-browser clients still require authenticated cookies.
  try {
    return (
      new URL(origin).origin ===
      authRequestOrigin(request.url, request.headers.get("host"))
    )
  } catch {
    return false
  }
}

/** Once a legacy operator is managed here, the shared password cannot bypass that record. */
export async function legacyPlatformEnabled(email: string) {
  const { data, error } = await supabase
    .from("platform_admin_access")
    .select("id")
    .eq("email", email.toLowerCase())
    .maybeSingle()
  return !error && !data
}
