import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let cached: SupabaseClient | undefined

function getConfiguredServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_KEY?.trim()
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY (service role) for server-side database access.",
    )
  }
  if (!cached) {
    cached = createClient(url, key)
  }
  return cached
}

/** Explicit access (same lazy client as {@link supabase}). */
export function getServiceSupabase(): SupabaseClient {
  return getConfiguredServiceClient()
}

/**
 * Lazy server-side Supabase client (service role). Safe to import during Next.js
 * builds when env is unset; the client is created on first property access.
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, _receiver) {
    const client = getConfiguredServiceClient()
    const value = Reflect.get(client, prop, client) as unknown
    if (typeof value === "function") {
      return (value as (...args: unknown[]) => unknown).bind(client)
    }
    return value
  },
})
