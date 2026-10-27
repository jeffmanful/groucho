// What we know about the applicant's own connection: IP, user agent and language.
//
// Most clients relay Groucho through their own server so the API key stays secret. Then the request
// Groucho receives comes from the client's server, not the applicant's browser. The client's relay
// (`createGrouchoRelay` in the SDK) forwards the applicant's details in the X-Groucho-Applicant-*
// headers, and Groucho trusts those only on requests carrying a valid API key: whoever holds the key
// is the client, and the relay strips any copies the browser sent.
//
// IPs are never stored. We keep a keyed hash of the address and of its network (/24 or /48), which is
// enough to see that entries share a connection without being able to recover the address.
import { createHash, createHmac } from "crypto"
import { isIP } from "net"
import { after } from "next/server"
import { log } from "@/lib/logger"
import { supabase } from "@/lib/supabase"

export const APPLICANT_HEADERS = {
  ip: "x-groucho-applicant-ip",
  userAgent: "x-groucho-applicant-user-agent",
  language: "x-groucho-applicant-language",
} as const

/**
 * forwarded: the client's relay passed on the applicant's details (trusted: the request has a key).
 * direct: the applicant's browser called Groucho itself (demo and keyless default projects).
 * relay: a keyed request without forwarded details. We only see the client's server, so we record nothing.
 */
export type ApplicantSignalSource = "forwarded" | "direct" | "relay"

export type ApplicantSignals = {
  source: ApplicantSignalSource
  ip: string | null
  userAgent: string | null
  language: string | null
}

const MAX_USER_AGENT = 400
const MAX_LANGUAGE = 100

function clean(value: string | null, max: number): string | null {
  // Drop control characters; header values are attacker-supplied text.
  const text = value?.replace(/[\u0000-\u001f\u007f]/g, "").trim()
  return text ? text.slice(0, max) : null
}

/** A bare IP from a header value: strips ports and brackets, takes the first of a list. */
export function parseIp(value: string | null | undefined): string | null {
  let text = value?.split(",")[0]?.trim()
  if (!text) return null
  if (text.startsWith("[")) text = text.slice(1, text.indexOf("]") > 0 ? text.indexOf("]") : undefined)
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(text)) text = text.slice(0, text.lastIndexOf(":"))
  const mapped = /^::ffff:(\d{1,3}(\.\d{1,3}){3})$/i.exec(text)
  if (mapped) text = mapped[1]
  return isIP(text) ? text.toLowerCase() : null
}

/** The address of the connection that reached Groucho (set by our hosting platform). */
function directIp(headers: Headers): string | null {
  return parseIp(headers.get("x-vercel-forwarded-for")) ?? parseIp(headers.get("x-real-ip")) ?? parseIp(headers.get("x-forwarded-for"))
}

export function readApplicantSignals(headers: Headers, options: { viaApiKey: boolean }): ApplicantSignals {
  if (options.viaApiKey) {
    const ip = parseIp(headers.get(APPLICANT_HEADERS.ip))
    const userAgent = clean(headers.get(APPLICANT_HEADERS.userAgent), MAX_USER_AGENT)
    const language = clean(headers.get(APPLICANT_HEADERS.language), MAX_LANGUAGE)
    if (ip || userAgent) return { source: "forwarded", ip, userAgent, language }
    return { source: "relay", ip: null, userAgent: null, language: null }
  }
  return {
    source: "direct",
    ip: directIp(headers),
    userAgent: clean(headers.get("user-agent"), MAX_USER_AGENT),
    language: clean(headers.get("accept-language"), MAX_LANGUAGE),
  }
}

/** Full eight-group form, so equal addresses written differently hash the same. */
function expandIpv6(ip: string): string[] {
  const [head, tail = ""] = ip.split("::")
  const left = head ? head.split(":") : []
  const right = tail ? tail.split(":") : []
  const missing = ip.includes("::") ? 8 - left.length - right.length : 0
  return [...left, ...Array(Math.max(0, missing)).fill("0"), ...right].map((group) => group.padStart(4, "0"))
}

/** The network an address belongs to: IPv4 /24, IPv6 /48. */
export function networkOf(ip: string): string {
  if (isIP(ip) === 4) return `${ip.split(".").slice(0, 3).join(".")}.0/24`
  return `${expandIpv6(ip).slice(0, 3).join(":")}::/48`
}

function canonicalIp(ip: string): string {
  return isIP(ip) === 6 ? expandIpv6(ip).join(":") : ip
}

function hashSecret(): string | null {
  const configured = process.env.GROUCHO_SIGNAL_HASH_SECRET?.trim()
  if (configured) return configured
  // Fall back to a value derived from the service key, which only the server has.
  const serviceKey = process.env.SUPABASE_SERVICE_KEY?.trim()
  return serviceKey ? createHash("sha256").update(`groucho-applicant-signals:${serviceKey}`).digest("hex") : null
}

function keyedHash(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex").slice(0, 32)
}

/** The columns stored on the session. No raw IP. */
export function applicantSignalColumns(signals: ApplicantSignals, now = new Date()) {
  const secret = hashSecret()
  const ip = signals.ip ? canonicalIp(signals.ip) : null
  return {
    applicant_signal_source: signals.source,
    applicant_ip_hash: ip && secret ? keyedHash(secret, `ip:${ip}`) : null,
    applicant_network_hash: ip && secret ? keyedHash(secret, `net:${networkOf(ip)}`) : null,
    applicant_user_agent: signals.userAgent,
    applicant_language: signals.language,
    applicant_signals_at: now.toISOString(),
  }
}

let missingColumnsLogged = false

/** Records the signals the first time a session is seen; later requests don't overwrite them. */
export async function recordApplicantSignals(
  target: { sessionRowId: string } | { projectId: string; sessionKey: string },
  signals: ApplicantSignals,
): Promise<void> {
  try {
    let query = supabase.from("sessions").update(applicantSignalColumns(signals)).is("applicant_signal_source", null)
    query = "sessionRowId" in target
      ? query.eq("id", target.sessionRowId)
      : query.eq("project_id", target.projectId).eq("session_id", target.sessionKey)
    const { error } = await query
    if (!error) return
    if (error.code === "42703" || error.code === "PGRST204") {
      if (!missingColumnsLogged) log.info("applicant_signals_columns_missing", {})
      missingColumnsLogged = true
      return
    }
    log.warn("applicant_signals_record_failed", { detail: error.message })
  } catch (error) {
    log.warn("applicant_signals_record_failed", { detail: error instanceof Error ? error.message : String(error) })
  }
}

/** Records after the response is sent, so applicants never wait on it. */
export function scheduleApplicantSignals(
  target: Parameters<typeof recordApplicantSignals>[0],
  signals: ApplicantSignals,
): void {
  const task = () => recordApplicantSignals(target, signals)
  try {
    after(task)
  } catch {
    // Outside a request (scripts, tests): run it now.
    void task()
  }
}
