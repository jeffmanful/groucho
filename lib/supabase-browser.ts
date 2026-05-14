import { createBrowserClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"

/** Returns a browser client when public Supabase env is set; otherwise `null` (e.g. CI build, misconfigured preview). */
export function tryCreateSupabaseBrowserClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (!url || !anon) return null
  return createBrowserClient(url, anon)
}

/** Browser Supabase client for invitee auth (OTP / magic link flows). */
export function createSupabaseBrowserClient(): SupabaseClient {
  const client = tryCreateSupabaseBrowserClient()
  if (!client) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    )
  }
  return client
}
