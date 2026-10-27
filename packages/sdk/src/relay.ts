import { APPLICANT_HEADERS, setApplicantHeaders, type ApplicantConnection } from "./applicant.js"

/**
 * Where to read the applicant's IP, in order. Each is set by a hosting platform or load balancer and
 * overwrites whatever the browser sent. Only rely on the default if your platform sets one of these;
 * otherwise pass `clientIp`.
 */
const IP_HEADERS = [
  "x-vercel-forwarded-for", // Vercel
  "cf-connecting-ip", // Cloudflare
  "fly-client-ip", // Fly.io
  "x-nf-client-connection-ip", // Netlify
  "x-real-ip", // nginx and most load balancers
  "x-forwarded-for", // first entry
] as const

/** The applicant's IP from your platform's headers, or null. */
export function applicantIpFrom(request: Request): string | null {
  for (const name of IP_HEADERS) {
    const value = request.headers.get(name)?.split(",")[0]?.trim()
    if (value) return value
  }
  return null
}

/** The applicant's connection, read from the incoming browser request. */
export function applicantFromRequest(
  request: Request,
  options: { clientIp?: (request: Request) => string | null | undefined } = {},
): ApplicantConnection {
  return {
    ip: (options.clientIp ? options.clientIp(request) : applicantIpFrom(request)) ?? null,
    userAgent: request.headers.get("user-agent"),
    language: request.headers.get("accept-language"),
  }
}

/** The applicant-facing endpoints a conversations key needs. */
export const APPLICANT_PATHS: readonly RegExp[] = [
  /^v1\/sessions\/[^/]+$/,
  /^v1\/sessions\/[^/]+\/(start|messages|access)$/,
  /^v1\/entries$/,
]

export type GrouchoRelayOptions = {
  /** Groucho API origin, e.g. `https://groucho.example.com`. */
  baseUrl: string
  /** A **conversations** key. Never an applications key. */
  apiKey: string
  /**
   * Returns the applicant's IP. Defaults to your platform's headers (Vercel, Cloudflare, Fly.io,
   * Netlify, then `X-Real-IP` and `X-Forwarded-For`). Set this if your server isn't behind one of those,
   * or the browser could choose its own IP.
   */
  clientIp?: (request: Request) => string | null | undefined
  /** Paths the browser may reach. Defaults to {@link APPLICANT_PATHS}. */
  allowedPaths?: readonly RegExp[]
  fetch?: typeof fetch
}

/** Joins and re-encodes path segments; null for anything that tries to leave the API (`..`, encoded slashes). */
function normalisePath(path: string | readonly string[]): string | null {
  const segments = (typeof path === "string" ? path.split("/") : [...path]).filter(Boolean)
  const out: string[] = []
  for (const segment of segments) {
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      return null
    }
    if (decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\")) return null
    out.push(encodeURIComponent(decoded))
  }
  return out.length ? out.join("/") : null
}

/** Request headers worth passing on. Cookies and your own auth headers never leave your server. */
const PASS_THROUGH = ["content-type", "accept", "x-request-id"] as const
/** Response headers that no longer describe the body after `fetch` has decoded it. */
const DROP_FROM_RESPONSE = new Set(["content-encoding", "content-length", "transfer-encoding", "connection"])

/**
 * A relay for your browser-facing route: keeps your API key on the server and forwards the applicant's
 * IP, user agent and language so Groucho can see entries that share a connection.
 *
 * ```ts
 * // app/api/groucho/[...path]/route.ts
 * const relay = createGrouchoRelay({ baseUrl: process.env.GROUCHO_API_BASE_URL!, apiKey: process.env.GROUCHO_API_KEY! })
 * export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
 *   return relay(req, (await ctx.params).path)
 * }
 * export const POST = GET
 * ```
 */
export function createGrouchoRelay(options: GrouchoRelayOptions): (request: Request, path: string | readonly string[]) => Promise<Response> {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  const base = options.baseUrl.replace(/\/$/, "")
  const allowed = options.allowedPaths ?? APPLICANT_PATHS

  return async function relay(request, path) {
    const cleanPath = normalisePath(path)
    if (!cleanPath || !allowed.some((pattern) => pattern.test(cleanPath))) {
      return Response.json({ error: "Not found" }, { status: 404 })
    }

    const url = new URL(`${base}/${cleanPath}`)
    url.search = new URL(request.url).search

    const headers = new Headers()
    for (const name of PASS_THROUGH) {
      const value = request.headers.get(name)
      if (value) headers.set(name, value)
    }
    headers.set("Authorization", `Bearer ${options.apiKey}`)
    // Built from the real connection; anything the browser sent under these names is ignored.
    setApplicantHeaders(headers, applicantFromRequest(request, { clientIp: options.clientIp }))

    const init: RequestInit = { method: request.method, headers }
    if (request.method !== "GET" && request.method !== "HEAD") init.body = await request.arrayBuffer()

    const upstream = await fetchImpl(url, init)
    const out = new Headers()
    upstream.headers.forEach((value, name) => {
      if (!DROP_FROM_RESPONSE.has(name.toLowerCase())) out.set(name, value)
    })
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out })
  }
}

export { APPLICANT_HEADERS }
