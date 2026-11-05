/** Default mode permits only explicit loopback services; never inherit application .env files. */
export function loopbackUrl(raw: string): URL {
  const url = new URL(raw)
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password) {
    throw new Error("Load tests require an explicit http://127.0.0.1 or http://[::1] service URL")
  }
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("Service URL must be an origin")
  return url
}

/** The current live Groucho database is always excluded from staging load tests. */
export const PRODUCTION_SUPABASE_REF = "qqbvcmqzwtifpyufkxhh"

export function databaseTarget(raw: string, stagingRef?: string): URL {
  if (!stagingRef) return loopbackUrl(raw)
  if (!/^[a-z]{20}$/.test(stagingRef) || stagingRef === PRODUCTION_SUPABASE_REF) {
    throw new Error("Staging must identify a separate Supabase project/branch, never the live Groucho database")
  }
  const url = new URL(raw)
  if (url.href !== `https://${stagingRef}.supabase.co/`) {
    throw new Error("Staging database URL must exactly match LOADTEST_STAGING_PROJECT_REF over HTTPS")
  }
  return url
}

export function installFetchGuard(origins: string[], stagingRef?: string) {
  const allowed = new Set(origins.map(value => {
    const url = new URL(value)
    return url.protocol === "https:" && stagingRef ? databaseTarget(value, stagingRef).origin : loopbackUrl(value).origin
  }))
  const original = globalThis.fetch
  const blocked: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (!allowed.has(url.origin)) {
      blocked.push(url.origin)
      throw new Error(`Load-test egress blocked: ${url.origin}`)
    }
    return original(input, { ...init, redirect: "error" })
  }) as typeof fetch
  return { blocked, restore: () => { globalThis.fetch = original } }
}

export function configureIsolatedEnvironment(databaseUrl: string, serviceKey: string, aiUrl: string, rateLimit: number, stagingRef?: string) {
  databaseTarget(databaseUrl, stagingRef)
  loopbackUrl(aiUrl)
  // Delete inherited credentials/config before importing application modules. No dotenv/Next env loader.
  for (const key of Object.keys(process.env)) {
    if (/^(ANTHROPIC|OPENAI|SUPABASE|NEXT_PUBLIC_|GROUCHO|GROUPCHO|COLORS|VERCEL|AUTH_|CRON_|RESEND|SENDGRID)/.test(key)) delete process.env[key]
  }
  Object.assign(process.env, {
    NODE_ENV: "test",
    NEXT_PUBLIC_SUPABASE_URL: databaseUrl,
    SUPABASE_SERVICE_KEY: serviceKey,
    ANTHROPIC_BASE_URL: aiUrl,
    ANTHROPIC_API_KEY: "load-test-dummy-key-not-a-real-credential",
    GROUCHO_COLORS_THIN_CONVERSATION_MODEL: "claude-haiku-5-5",
    GROUPCHO_REQUIRE_API_KEY: "true",
    GROUCHO_RL_API_KEY_PER_MINUTE: String(rateLimit),
    GROUCHO_RL_SESSION_PER_MINUTE: "30",
  })
}
