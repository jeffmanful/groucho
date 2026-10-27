// Client-safe types and data sources for the applications review workspace.
import type { ReviewerReport } from "@/lib/reviewer-report"

export const QUEUE_ORDER = [
  "ready_for_review",
  "awaiting_assessment",
  "in_progress",
  "approved",
  "declined",
  "abandoned",
  "all",
] as const
export type QueueKey = (typeof QUEUE_ORDER)[number]

export const QUEUE_LABEL: Record<QueueKey, string> = {
  ready_for_review: "Ready for review",
  awaiting_assessment: "Awaiting assessment",
  in_progress: "In progress",
  approved: "Approved",
  declined: "Declined",
  abandoned: "Abandoned",
  all: "All",
}

export type Recommendation = "recommend" | "human_review" | "decline"
export type SuitabilityBand = "recommended_acceptance" | "review" | "below_threshold"

export type ApplicationItem = {
  id: string
  sessionKey: string
  status: string
  queue: Exclude<QueueKey, "all">
  createdAt: string
  updatedAt: string
  applicant: {
    name: string | null
    email: string | null
    audience: "community" | "artist"
    artistName: string | null
    city: string | null
    age: number | null
    socialLinks: string[]
    musicLinks: string[]
  }
  assessment: {
    suitabilityScore: number | null
    suitabilityBand: SuitabilityBand | null
    recommendation: Recommendation | null
    confidence: number | null
    reportStatus: string | null
    conversationModel: string | null
    answerCount: number
  }
  decision: {
    decision: "approved" | "declined"
    source: "human" | "policy" | null
    /** Where it was made: this dashboard, the client's own app through the API, or their policy. */
    via?: "dashboard" | "api" | "policy"
    reviewer: string | null
    reason: string | null
    decidedAt: string | null
    /** The current decision's id, needed to correct it. */
    id?: string | null
    corrected?: boolean
    applicantReason?: string | null
  } | null
  /** The latest outcome the client's system reported after the decision. */
  latestOutcome?: { outcome: string; at: string | null } | null
}

export type QueueMetrics = {
  awaitingReview: number
  oldestPendingSince: string | null
  decidedLast7Days: number
  medianHoursToDecision: number | null
}

export type ApplicationFilters = {
  queue: QueueKey
  audience: "all" | "community" | "artist"
  recommendation: "all" | Recommendation
  band: "all" | SuitabilityBand
  from: string
  to: string
  search: string
  sort: "suitability" | "newest" | "oldest" | "longest_waiting"
  offset: number
}

export const PAGE_SIZE = 25

export const DEFAULT_FILTERS: ApplicationFilters = {
  queue: "ready_for_review",
  audience: "all",
  recommendation: "all",
  band: "all",
  from: "",
  to: "",
  search: "",
  sort: "suitability",
  offset: 0,
}

export type ApplicationsPage = {
  applications: ApplicationItem[]
  total: number
  counts: Record<QueueKey, number>
  metrics: QueueMetrics
  policy: { acceptanceThreshold: number; reviewThreshold: number }
}

export type ApplicationDetail = {
  messages: Array<{ id: string; role: "user" | "assistant"; content: string; sent_at?: string }>
  reviewerReport: ReviewerReport | null
  details: Record<string, unknown> | null
}

export type ProjectChoice = {
  id: string
  organisationId: string
  name: string
  organisationName: string
  demo?: boolean
  /** Owners and admins can record decisions; other members can review only. */
  canDecide: boolean
}

export interface ApplicationsSource {
  list(filters: ApplicationFilters): Promise<ApplicationsPage>
  detail(application: ApplicationItem): Promise<ApplicationDetail>
  decide(application: ApplicationItem, decision: "approved" | "declined", reason: string): Promise<void>
  exportCsv(filters: ApplicationFilters): Promise<{ filename: string; csv: string } | { url: string }>
}

/** Score range for a band under the project's thresholds. */
export function bandRange(band: ApplicationFilters["band"], policy: ApplicationsPage["policy"]): { min: number | null; max: number | null } {
  if (band === "recommended_acceptance") return { min: policy.acceptanceThreshold, max: null }
  if (band === "review") return { min: policy.reviewThreshold, max: Math.max(0, policy.acceptanceThreshold - 0.0001) }
  if (band === "below_threshold") return { min: null, max: Math.max(0, policy.reviewThreshold - 0.0001) }
  return { min: null, max: null }
}

export function queryString(filters: ApplicationFilters): string {
  const params = new URLSearchParams()
  params.set("queue", filters.queue)
  params.set("sort", filters.sort)
  params.set("offset", String(filters.offset))
  params.set("limit", String(PAGE_SIZE))
  if (filters.audience !== "all") params.set("audience", filters.audience)
  if (filters.recommendation !== "all") params.set("recommendation", filters.recommendation)
  if (filters.band !== "all") params.set("band", filters.band)
  if (filters.from) params.set("from", filters.from)
  if (filters.to) params.set("to", filters.to)
  if (filters.search.trim()) params.set("q", filters.search.trim())
  return params.toString()
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : `Request failed (${response.status})`
    throw new Error(message)
  }
  return body as T
}

/** Reads and writes a real project through the admin API. */
export function apiSource(project: ProjectChoice): ApplicationsSource {
  const base = `/api/admin/organisations/${project.organisationId}/projects/${project.id}`
  return {
    async list(filters) {
      return json<ApplicationsPage>(await fetch(`${base}/applications?${queryString(filters)}`, { cache: "no-store" }))
    },
    async detail(application) {
      const body = await json<{ messages?: ApplicationDetail["messages"]; reviewerReport?: ReviewerReport | null }>(
        await fetch(`${base}/sessions/${application.id}/messages`, { cache: "no-store" }),
      )
      return {
        messages: (body.messages ?? []).filter((message) => message.role === "user" || message.role === "assistant"),
        reviewerReport: body.reviewerReport ?? null,
        details: null,
      }
    },
    async decide(application, decision, reason) {
      await json(await fetch(`${base}/sessions/${application.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      }))
    },
    async exportCsv(filters) {
      return { url: `${base}/applications/export?${queryString({ ...filters, offset: 0 })}` }
    },
  }
}
