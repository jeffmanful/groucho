import { createGrouchoRelay, type GrouchoRelayOptions } from "./relay.js"

export type GrouchoApplicantRelayOptions = Omit<GrouchoRelayOptions, "allowedPaths"> & {
  /** Browser-facing route prefix. Session cookies are limited to this path. */
  cookiePath: string
  /** Optional independent signing key; otherwise the server-only conversations key is used. */
  sessionSecret?: string
  /** A grant resolved on the host server, never read from browser input. */
  invitation?: { token: string; sessionId: string }
}

const MAX_AGE_SECONDS = 7 * 24 * 60 * 60
const PATH = /^v1\/sessions\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/(start|messages))?$/i
const PUBLIC_FIELDS = ["id", "clientSessionKey", "status", "outcome", "message", "ui", "applicant", "projectType", "resumed", "bootstrapped", "turnsUsed", "startedAt", "completedAt"] as const
const encode = (text: string) => btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const decode = (text: string) => atob(text.replace(/-/g, "+").replace(/_/g, "/"))

/**
 * A browser-facing gatekeeper relay with session ownership and a strict response allowlist.
 * Reports, scores, profiles, decisions and access secrets stay on the server. No applications
 * routes, arbitrary methods, persona overrides or project selection are exposed to the browser.
 */
export function createGrouchoApplicantRelay(options: GrouchoApplicantRelayOptions) {
  const relay = createGrouchoRelay({ ...options, allowedPaths: [/^v1\/sessions\/[^/]+(?:\/(?:start|messages))?$/] })
  const cookiePath = options.cookiePath.replace(/\/$/, "")
  if (!cookiePath.startsWith("/") || /[;\r\n]/.test(cookiePath)) throw new Error("cookiePath must be a local route prefix")
  const key = crypto.subtle.importKey("raw", new TextEncoder().encode(`groucho-applicant-v1:${options.sessionSecret ?? options.apiKey}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])
  const cookieName = (id: string) => `groucho_applicant_${id.replaceAll("-", "")}`
  async function token(id: string) {
    const body = encode(JSON.stringify({ id, issuedAt: Date.now() }))
    const signature = await crypto.subtle.sign("HMAC", await key, new TextEncoder().encode(body))
    return `${body}.${encode(String.fromCharCode(...new Uint8Array(signature)))}`
  }
  async function owns(request: Request, id: string) {
    const raw = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${cookieName(id)}=`))?.slice(cookieName(id).length + 1)
    if (!raw) return false
    try {
      const [body, signature, extra] = raw.split(".")
      if (!body || !signature || extra) return false
      if (!(await crypto.subtle.verify("HMAC", await key, Uint8Array.from(decode(signature), character => character.charCodeAt(0)), new TextEncoder().encode(body)))) return false
      const value = JSON.parse(decode(body)) as { id: string; issuedAt: number }
      const age = Date.now() - value.issuedAt
      return value.id === id && Number.isFinite(age) && age >= -60_000 && age < MAX_AGE_SECONDS * 1000
    } catch { return false }
  }
  return async (request: Request, segments: readonly string[]): Promise<Response> => {
    // Match the original segments; never normalise an encoded path into an allowed one.
    const path = segments.join("/")
    const match = PATH.exec(path)
    const action = match?.[2]
    if (!match || (action ? request.method !== "POST" : request.method !== "GET")) return Response.json({ error: "Not found" }, { status: 404 })
    const origin = request.headers.get("origin")
    const requestUrl = new URL(request.url)
    const host = request.headers.get("host")
    const browserOrigin = ["localhost", "127.0.0.1"].includes(requestUrl.hostname) && host && /^(localhost|127\.0\.0\.1):\d+$/.test(host)
      ? `${requestUrl.protocol}//${host}` : requestUrl.origin
    if ((origin && origin !== browserOrigin) || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "Forbidden" }, { status: 403 })
    const id = match[1]
    if (options.invitation && options.invitation.sessionId !== id) return Response.json({ error: "This invitation does not authorize that application." }, { status: 403 })
    const owned = await owns(request, id)
    if (!owned && !options.invitation && action !== "start") return Response.json({ error: "Application session unavailable" }, { status: 401 })
    try {
      if (!owned && !options.invitation) {
        // Knowing another applicant's UUID is not enough to claim its session on this host.
        const lookup = await relay(new Request(request.url, { headers: request.headers }), ["v1", "sessions", id])
        if (lookup.status !== 404) return Response.json({ error: lookup.ok ? "Application session unavailable. Start a new application." : "The application could not be started. Please retry." }, { status: lookup.ok ? 403 : 503 })
      }
      let outgoing = request
      if (action) {
        const body = await request.json().catch(() => null)
        if (!body || typeof body !== "object") return Response.json({ error: "Invalid request" }, { status: 400 })
        const allowed = action === "start" ? { applicant: body.applicant, ...(options.invitation ? { invitationToken: options.invitation.token } : {}) } : { message: body.message, ...(body.interactionAnswer ? { interactionAnswer: body.interactionAnswer } : {}) }
        outgoing = new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(allowed) })
      }
      const upstream = await relay(outgoing, segments)
      const body = await upstream.json().catch(() => null)
      if (!body || typeof body !== "object") return Response.json({ error: "The application service is unavailable. Please retry." }, { status: 502 })
      const clean: Record<string, unknown> = upstream.ok
        ? Object.fromEntries(PUBLIC_FIELDS.filter(field => body[field] !== undefined).map(field => [field, body[field]]))
        : { error: typeof body.error === "string" ? body.error : "The request could not be completed." }
      // Kept for the SDK's existing message contract; these carry no assessment information.
      if (action === "messages" && upstream.ok) clean.scores = { specificity: 0.5, authenticity: 0.5, cultural_depth: 0.5, overall: 0.5 }
      const response = Response.json(clean, { status: upstream.status, headers: { "Cache-Control": "private, no-store" } })
      if (action === "start" && upstream.ok) response.headers.append("Set-Cookie", `${cookieName(id)}=${await token(id)}; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`)
      const retryAfter = upstream.headers.get("retry-after")
      if (retryAfter) response.headers.set("Retry-After", retryAfter)
      return response
    } catch { return Response.json({ error: "The application service is unavailable. Please retry." }, { status: 502 }) }
  }
}
