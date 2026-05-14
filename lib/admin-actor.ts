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
 * Org members authenticate with Supabase (same cookies as invite / org signup).
 */
export async function resolveAdminActor(): Promise<AdminActor | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get("pe_auth")?.value
  const secret = process.env.AUTH_SECRET
  if (token && secret) {
    const email = await verifyPeAuthEmail(token, secret)
    if (email && isAllowedPlatformEmail(email)) {
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
    return { kind: "member", userId: user.id, email: user.email ?? null }
  }

  return null
}
