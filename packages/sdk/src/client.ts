import type { components } from "./generated/openapi.js"
import { GrouchoApiError } from "./errors.js"

export type PostMessageResponse = components["schemas"]["PostMessageResponse"]
export type Session = components["schemas"]["Session"]
export type ScoreBreakdown = components["schemas"]["ScoreBreakdown"]
export type SessionOutcome = components["schemas"]["SessionOutcome"]
export type Profile = components["schemas"]["Profile"]
export type ProfileCore = components["schemas"]["ProfileCore"]
export type ProfileExtraction = components["schemas"]["ProfileExtraction"]
export type ApplicantIdentity = components["schemas"]["ApplicantIdentity"]

export type GrouchoClientOptions = {
  /** API origin + optional path prefix, e.g. `https://api.example.com` or `https://app.example.com/api/groucho` */
  baseUrl: string
  /**
   * Project API key (`gk_*`). Omit for **host-proxy** mode: requests go to `baseUrl` without
   * `Authorization` (the host route attaches the secret).
   */
  apiKey?: string
  fetch?: typeof fetch
}

export interface GrouchoClient {
  sendMessage(
    sessionId: string,
    input: {
      message: string
      personaId?: string | null
      applicant?: ApplicantIdentity | null
    },
  ): Promise<PostMessageResponse>

  getSession(sessionId: string): Promise<Session>

  submitAccessEmail(
    sessionId: string,
    input: { email: string; secret?: string },
  ): Promise<void>
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/$/, "")
  const p = path.startsWith("/") ? path : `/${path}`
  return `${b}${p}`
}

async function readErrorBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function errorMessage(status: number, body: unknown): string {
  if (body && typeof body === "object" && "error" in body) {
    const e = (body as { error?: unknown }).error
    if (typeof e === "string") return e
  }
  return `HTTP ${status}`
}

export function createClient(options: GrouchoClientOptions): GrouchoClient {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  const { apiKey } = options

  function headers(base: HeadersInit | undefined): Headers {
    const h = new Headers(base)
    h.set("Content-Type", "application/json")
    if (apiKey) h.set("Authorization", `Bearer ${apiKey}`)
    return h
  }

  async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
    const res = await fetchImpl(url, init)
    if (!res.ok) {
      const body = await readErrorBody(res)
      throw new GrouchoApiError(errorMessage(res.status, body), res.status, body)
    }
    const ct = res.headers.get("content-type")
    if (ct?.includes("application/json")) {
      return (await res.json()) as T
    }
    return undefined as T
  }

  async function requestVoid(url: string, init: RequestInit): Promise<void> {
    const res = await fetchImpl(url, init)
    if (!res.ok) {
      const body = await readErrorBody(res)
      throw new GrouchoApiError(errorMessage(res.status, body), res.status, body)
    }
  }

  return {
    async sendMessage(sessionId, input) {
      const url = joinUrl(
        options.baseUrl,
        `/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
      )
      return requestJson<PostMessageResponse>(url, {
        method: "POST",
        headers: headers(undefined),
        body: JSON.stringify({
          message: input.message,
          personaId: input.personaId ?? null,
          ...(input.applicant ? { applicant: input.applicant } : {}),
        }),
      })
    },

    async getSession(sessionId) {
      const url = joinUrl(
        options.baseUrl,
        `/v1/sessions/${encodeURIComponent(sessionId)}`,
      )
      return requestJson<Session>(url, {
        method: "GET",
        headers: headers(undefined),
      })
    },

    async submitAccessEmail(sessionId, input) {
      const url = joinUrl(
        options.baseUrl,
        `/v1/sessions/${encodeURIComponent(sessionId)}/access`,
      )
      return requestVoid(url, {
        method: "POST",
        headers: headers(undefined),
        body: JSON.stringify({
          email: input.email,
          ...(input.secret !== undefined ? { secret: input.secret } : {}),
        }),
      })
    },
  }
}
