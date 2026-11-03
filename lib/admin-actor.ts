import {
  legacyPlatformEnabled,
} from "@/lib/platform-admin-access"
import { dashboardAccess } from "@/lib/dashboard-access"
import { cookies } from "next/headers"
import { verifyPeAuthEmail, isAllowedPlatformEmail } from "@/lib/pe-auth"
import {
  createSupabaseServerClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase-server"

export type AdminActor =
  | { kind: "platform"; email: string }
  | { kind: "member"; userId: string; email: string | null }

/**
 * Platform operator (`pe_auth` + allowlist) takes precedence over Supabase session.
 * Supabase identities require an existing membership or an active platform grant.
 */
export async function resolveAdminActor(): Promise<AdminActor | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get("pe_auth")?.value
  const secret = process.env.AUTH_SECRET
  if (token && secret) {
    const email = await verifyPeAuthEmail(token, secret)
    if (
      email &&
      isAllowedPlatformEmail(email) &&
      (await legacyPlatformEnabled(email))
    ) {
      return { kind: "platform", email }
    }
  }

  if (!isSupabaseServerConfigured()) {
    return null
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user?.id) {
    const access = await dashboardAccess(user)
    if (access === "platform") return { kind: "platform", email: user.email! }
    if (access === "member") return { kind: "member", userId: user.id, email: user.email! }
  }

  return null
}
