import type { components } from "./generated/openapi.js"
import { setApplicantHeaders, type ApplicantConnection } from "./applicant.js"
import { GrouchoApiError } from "./errors.js"

export type PostMessageResponse = components["schemas"]["PostMessageResponse"]
export type GrouchoInteractionUi = components["schemas"]["GrouchoInteractionUi"]
export type OpeningInteraction = components["schemas"]["OpeningInteraction"]
export type StartSessionResponse = components["schemas"]["StartSessionResponse"]
export type Session = components["schemas"]["Session"]
export type ScoreBreakdown = components["schemas"]["ScoreBreakdown"]
export type SessionOutcome = components["schemas"]["SessionOutcome"]
export type ApplicationReviewStatus = components["schemas"]["ApplicationReviewStatus"]
export type Profile = components["schemas"]["Profile"]
export type ProfileCore = components["schemas"]["ProfileCore"]
export type ProfileExtraction = components["schemas"]["ProfileExtraction"]
export type ApplicantIdentity = components["schemas"]["ApplicantIdentity"]
export type ReviewerReport = components["schemas"]["ReviewerReport"]
export type MediaChoiceMode = components["schemas"]["MediaChoiceMode"]
export type MediaChoiceVideo = components["schemas"]["MediaChoiceVideo"]
export type MediaChoiceOption = components["schemas"]["MediaChoiceOption"]
export type MediaChoiceInteraction = components["schemas"]["MediaChoiceInteraction"]
export type MediaChoiceAnswer = components["schemas"]["MediaChoiceAnswer"]
export type InteractionAnswer = components["schemas"]["InteractionAnswer"]
export type Application = components["schemas"]["Application"]
export type ApplicationQueue = components["schemas"]["ApplicationQueue"]
export type ApplicationDecisionSummary = components["schemas"]["ApplicationDecisionSummary"]
export type ApplicationList = components["schemas"]["ApplicationList"]
export type ApplicationDetail = components["schemas"]["ApplicationDetail"]
export type DecideApplicationRequest = components["schemas"]["DecideApplicationRequest"]
export type DecideApplicationResponse = components["schemas"]["DecideApplicationResponse"]
export type ApplicationOutcome = components["schemas"]["ApplicationOutcome"]
export type DecisionHistoryEntry = components["schemas"]["DecisionHistoryEntry"]
export type CorrectApplicationRequest = components["schemas"]["CorrectApplicationRequest"]
export type CorrectApplicationResponse = components["schemas"]["CorrectApplicationResponse"]
export type ReportOutcomeRequest = components["schemas"]["ReportOutcomeRequest"]
export type ReportOutcomeResponse = components["schemas"]["ReportOutcomeResponse"]
export type SubmitEntryRequest = components["schemas"]["SubmitEntryRequest"]
export type SubmitEntryResponse = components["schemas"]["SubmitEntryResponse"]
export type Cohort = components["schemas"]["Cohort"]
export type CohortList = components["schemas"]["CohortList"]
export type AddToCohortRequest = components["schemas"]["AddToCohortRequest"]
export type AddToCohortResponse = components["schemas"]["AddToCohortResponse"]

export type ListApplicationsQuery = {
  queue?: ApplicationQueue | "all"
  sort?: "suitability" | "newest" | "oldest" | "longest_waiting"
  /** Search name, email or artist name. */
  search?: string
  audience?: "community" | "artist" | "all"
  recommendation?: "recommend" | "human_review" | "decline" | "all"
  /** YYYY-MM-DD */
  from?: string
  /** YYYY-MM-DD */
  to?: string
  limit?: number
  offset?: number
}

/** Per-request options for calls made from your server on an applicant's behalf. */
export type ApplicantRequestOptions = {
  /** The applicant's IP, user agent and language, from the request your server received. */
  applicant?: ApplicantConnection
}

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
      interactionAnswer?: InteractionAnswer
    },
    requestOptions?: ApplicantRequestOptions,
  ): Promise<PostMessageResponse>

  getSession(sessionId: string): Promise<Session>

  submitAccessEmail(
    sessionId: string,
    input: { email: string; secret?: string },
  ): Promise<void>

  startSession(
    sessionId: string,
    input?: {
      personaId?: string | null
      applicant?: ApplicantIdentity | null
      openingMessage?: string | null
      openingInteraction?: OpeningInteraction | null
    },
    requestOptions?: ApplicantRequestOptions,
  ): Promise<StartSessionResponse>

  /**
   * Applications for the project, with Groucho's assessment. **Server only:** needs an
   * applications API key, which must never sit behind a browser-facing proxy.
   */
  listApplications(query?: ListApplicationsQuery): Promise<ApplicationList>

  /** One application with the reviewer report and conversation. Server only (applications key). */
  getApplication(sessionId: string): Promise<ApplicationDetail>

  /**
   * Approve or decline an application as the named reviewer. The first decision wins; a reason is
   * required to decline. Approvals return `accessSecret` for {@link GrouchoClient.submitAccessEmail}.
   * Server only (applications key).
   */
  decideApplication(sessionId: string, input: DecideApplicationRequest): Promise<DecideApplicationResponse>

  /**
   * Correct a decision, with a reason. The old decision stays in the history and Groucho sends
   * `application.decision_corrected`. Pass `expectedDecisionId` to fail with 409 if someone else
   * changed it first. Server only (applications key).
   */
  correctApplication(sessionId: string, input: CorrectApplicationRequest): Promise<CorrectApplicationResponse>

  /**
   * Report what happened after the decision (invited, joined, active, left...). Groucho uses this
   * to measure whether the people it recommends actually join. Server only (applications key).
   */
  reportOutcome(sessionId: string, input: ReportOutcomeRequest): Promise<ReportOutcomeResponse>

  /**
   * Submit a drop entry without a conversation: email, name, phone, socials and drop fields.
   * Sending the same `sessionId` again returns the first entry with `duplicate: true`.
   * Works with a conversations key (or host-proxy mode).
   */
  submitEntry(input: SubmitEntryRequest, requestOptions?: ApplicantRequestOptions): Promise<SubmitEntryResponse>

  /** The current round's cohorts. Server only (applications key). */
  listCohorts(): Promise<CohortList>

  /**
   * Place approved applicants in a cohort, e.g. the winners of a ballot you ran yourself.
   * `sessionIds` are your session ids. Server only (applications key).
   */
  addToCohort(cohortId: string, input: AddToCohortRequest): Promise<AddToCohortResponse>
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

function isJsonResponse(res: Response): boolean {
  return res.headers.get("content-type")?.includes("application/json") ?? false
}

function invalidJsonResponseError(res: Response): GrouchoApiError {
  return new GrouchoApiError(
    `Expected JSON response from Groucho API but received ${res.status} ${res.statusText || "OK"}`,
    res.status,
  )
}

function assertPostMessageResponse(
  value: unknown,
  status: number,
): asserts value is PostMessageResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GrouchoApiError(
      "Invalid Groucho API response: expected an object",
      status,
      value,
    )
  }

  const body = value as Record<string, unknown>
  if (typeof body.message !== "string" || typeof body.status !== "string") {
    throw new GrouchoApiError(
      "Invalid Groucho API response: missing message or status",
      status,
      value,
    )
  }
}

function assertStartSessionResponse(
  value: unknown,
  status: number,
): asserts value is StartSessionResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GrouchoApiError(
      "Invalid Groucho API response: expected an object",
      status,
      value,
    )
  }

  const body = value as Record<string, unknown>
  if (
    typeof body.message !== "string" ||
    typeof body.status !== "string" ||
    typeof body.projectType !== "string"
  ) {
    throw new GrouchoApiError(
      "Invalid Groucho API response: missing message, status, or projectType",
      status,
      value,
    )
  }
}

export function createClient(options: GrouchoClientOptions): GrouchoClient {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  const { apiKey } = options

  function headers(base: HeadersInit | undefined, applicant?: ApplicantConnection): Headers {
    const h = new Headers(base)
    if (applicant) setApplicantHeaders(h, applicant)
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
    if (isJsonResponse(res)) {
      return (await res.json()) as T
    }
    throw invalidJsonResponseError(res)
  }

  async function requestVoid(url: string, init: RequestInit): Promise<void> {
    const res = await fetchImpl(url, init)
    if (!res.ok) {
      const body = await readErrorBody(res)
      throw new GrouchoApiError(errorMessage(res.status, body), res.status, body)
    }
  }

  return {
    async sendMessage(sessionId, input, requestOptions) {
      const url = joinUrl(
        options.baseUrl,
        `/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
      )
      const res = await requestJson<PostMessageResponse>(url, {
        method: "POST",
        headers: headers(undefined, requestOptions?.applicant),
        body: JSON.stringify({
          message: input.message,
          personaId: input.personaId ?? null,
          ...(input.applicant ? { applicant: input.applicant } : {}),
          ...(input.interactionAnswer
            ? { interactionAnswer: input.interactionAnswer }
            : {}),
        }),
      })
      assertPostMessageResponse(res, 200)
      return res
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

    async startSession(sessionId, input = {}, requestOptions) {
      const url = joinUrl(
        options.baseUrl,
        `/v1/sessions/${encodeURIComponent(sessionId)}/start`,
      )
      const res = await requestJson<StartSessionResponse>(url, {
        method: "POST",
        headers: headers(undefined, requestOptions?.applicant),
        body: JSON.stringify({
          personaId: input.personaId ?? null,
          ...(input.applicant ? { applicant: input.applicant } : {}),
          ...(input.openingMessage ? { openingMessage: input.openingMessage } : {}),
          ...(input.openingInteraction
            ? { openingInteraction: input.openingInteraction }
            : {}),
        }),
      })
      assertStartSessionResponse(res, 200)
      return res
    },

    async listApplications(query = {}) {
      const params = new URLSearchParams()
      const entries: Array<[string, string | number | undefined]> = [
        ["queue", query.queue],
        ["sort", query.sort],
        ["q", query.search],
        ["audience", query.audience],
        ["recommendation", query.recommendation],
        ["from", query.from],
        ["to", query.to],
        ["limit", query.limit],
        ["offset", query.offset],
      ]
      for (const [name, value] of entries) {
        if (value !== undefined && value !== "") params.set(name, String(value))
      }
      const search = params.toString()
      const url = joinUrl(options.baseUrl, `/v1/applications${search ? `?${search}` : ""}`)
      return requestJson<ApplicationList>(url, { method: "GET", headers: headers(undefined) })
    },

    async getApplication(sessionId) {
      const url = joinUrl(options.baseUrl, `/v1/applications/${encodeURIComponent(sessionId)}`)
      return requestJson<ApplicationDetail>(url, { method: "GET", headers: headers(undefined) })
    },

    async decideApplication(sessionId, input) {
      const url = joinUrl(
        options.baseUrl,
        `/v1/applications/${encodeURIComponent(sessionId)}/decision`,
      )
      return requestJson<DecideApplicationResponse>(url, {
        method: "POST",
        headers: headers(undefined),
        body: JSON.stringify({
          decision: input.decision,
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
          ...(input.applicantReason !== undefined ? { applicantReason: input.applicantReason } : {}),
          ...(input.reviewer ? { reviewer: input.reviewer } : {}),
        }),
      })
    },

    async correctApplication(sessionId, input) {
      const url = joinUrl(
        options.baseUrl,
        `/v1/applications/${encodeURIComponent(sessionId)}/correction`,
      )
      return requestJson<CorrectApplicationResponse>(url, {
        method: "POST",
        headers: headers(undefined),
        body: JSON.stringify(input),
      })
    },

    async reportOutcome(sessionId, input) {
      const url = joinUrl(
        options.baseUrl,
        `/v1/applications/${encodeURIComponent(sessionId)}/outcomes`,
      )
      return requestJson<ReportOutcomeResponse>(url, {
        method: "POST",
        headers: headers(undefined),
        body: JSON.stringify(input),
      })
    },

    async submitEntry(input, requestOptions) {
      return requestJson<SubmitEntryResponse>(joinUrl(options.baseUrl, "/v1/entries"), {
        method: "POST",
        headers: headers(undefined, requestOptions?.applicant),
        body: JSON.stringify(input),
      })
    },

    async listCohorts() {
      return requestJson<CohortList>(joinUrl(options.baseUrl, "/v1/cohorts"), {
        method: "GET",
        headers: headers(undefined),
      })
    },

    async addToCohort(cohortId, input) {
      const url = joinUrl(options.baseUrl, `/v1/cohorts/${encodeURIComponent(cohortId)}/members`)
      return requestJson<AddToCohortResponse>(url, {
        method: "POST",
        headers: headers(undefined),
        body: JSON.stringify(input),
      })
    },
  }
}
