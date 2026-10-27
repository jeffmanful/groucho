// The built-in sample project for dashboard demos: fictional applicants whose conversations and
// reports were produced by the real engine (evals/demo-applications-generate.test.ts). Everything
// here runs in the browser; decisions live in memory and reset on reload.
import fixture from "@/lib/demo-applications.fixture.json"
import { normaliseReviewerReport, type ReviewerReport } from "@/lib/reviewer-report"
import {
  bandRange,
  PAGE_SIZE,
  type ApplicationDetail,
  type ApplicationFilters,
  type ApplicationItem,
  type ApplicationsPage,
  type ApplicationsSource,
  type ProjectChoice,
  type QueueKey,
  type SuitabilityBand,
} from "@/lib/applications-source"

export const DEMO_PROJECT: ProjectChoice = {
  id: "sample-community",
  organisationId: "sample",
  name: "Community membership (sample)",
  organisationName: "Sample organisation",
  demo: true,
  canDecide: true,
}

const POLICY = { acceptanceThreshold: 0.8, reviewThreshold: 0.55 }
const HOUR = 3_600_000

type FixtureApplication = {
  person: { name: string; city: string; age: number; audience: string; artistName?: string }
  email: string
  sessionId: string
  transcript: Array<{ id: string; role: "user" | "assistant"; content: string }>
  report: unknown
  suitabilityScore: number | null
}

type DemoRecord = {
  item: ApplicationItem
  detail: ApplicationDetail
}

function band(score: number | null): SuitabilityBand | null {
  if (score === null) return null
  if (score >= POLICY.acceptanceThreshold) return "recommended_acceptance"
  if (score >= POLICY.reviewThreshold) return "review"
  return "below_threshold"
}

/** Decisions already on record when the demo opens, so history and the decided queues have content. */
const PRESET_DECISIONS: Record<string, { decision: "approved" | "declined"; reason: string; hoursAfter: number }> = {
  "Maya Okafor": { decision: "approved", reason: "Runs a real listening community and would bring finds from London.", hoursAfter: 20 },
  "Rico Vance": { decision: "declined", reason: "Joining mainly to sell paid promotion to artists, which the Forum does not allow.", hoursAfter: 6 },
}

/** Applications that have not reached review yet, to populate the other queues. */
const UNFINISHED: Array<{ name: string; email: string; city: string; audience: "community" | "artist"; queue: "in_progress" | "awaiting_assessment" | "abandoned"; answers: string[] }> = [
  { name: "Noor Haddad", email: "noor.haddad@example.com", city: "Amman", audience: "community", queue: "in_progress", answers: ["I've been sharing COLORS shows with my sister for years and we talk about them every week."] },
  { name: "Felix Brandt", email: "felix.brandt@example.com", city: "Hamburg", audience: "artist", queue: "awaiting_assessment", answers: ["I produce ambient records and run a small cassette label.", "Mostly I want people to hear the tapes before they're pressed.", "I'd trade notes on mastering for tape, that's my thing."] },
  { name: "Grace Liu", email: "grace.liu@example.com", city: "Singapore", audience: "community", queue: "abandoned", answers: ["Saw a friend post about it."] },
]

function build(now: number): DemoRecord[] {
  const generated = (fixture as { applications: FixtureApplication[] }).applications
  const records: DemoRecord[] = generated.map((application, index) => {
    const report = normaliseReviewerReport(application.report) as ReviewerReport | null
    const createdAt = now - (index * 19 + 7) * HOUR
    const updatedAt = createdAt + 6 * 60_000
    const preset = PRESET_DECISIONS[application.person.name]
    const decidedAt = preset ? updatedAt + preset.hoursAfter * HOUR : null
    const audience = application.person.audience === "artist" ? "artist" : "community"
    return {
      item: {
        id: application.sessionId,
        sessionKey: application.sessionId,
        status: "completed",
        queue: preset ? preset.decision : "ready_for_review",
        createdAt: new Date(createdAt).toISOString(),
        updatedAt: new Date(updatedAt).toISOString(),
        applicant: {
          name: application.person.name,
          email: application.email,
          audience,
          artistName: application.person.artistName ?? null,
          city: application.person.city,
          age: application.person.age,
          socialLinks: [],
          musicLinks: [],
        },
        assessment: {
          suitabilityScore: application.suitabilityScore,
          suitabilityBand: band(application.suitabilityScore),
          recommendation: report?.advisory_recommendation ?? null,
          confidence: report?.confidence_score ?? null,
          reportStatus: report ? "ready" : null,
          conversationModel: "claude-haiku-5-5",
          answerCount: application.transcript.filter((message) => message.role === "user").length,
        },
        decision: preset && decidedAt ? {
          decision: preset.decision,
          source: "human",
          reviewer: "alex@sample-organisation.example",
          reason: preset.reason,
          decidedAt: new Date(decidedAt).toISOString(),
        } : null,
      },
      detail: {
        messages: application.transcript,
        reviewerReport: report,
        details: { city: application.person.city, age: application.person.age, ...(application.person.artistName ? { artistName: application.person.artistName } : {}) },
      },
    }
  })
  UNFINISHED.forEach((person, index) => {
    const createdAt = now - (index * 5 + 1) * HOUR
    records.push({
      item: {
        id: `sample-unfinished-${index + 1}`,
        sessionKey: `sample-unfinished-${index + 1}`,
        status: person.queue === "in_progress" ? "active" : person.queue === "abandoned" ? "abandoned" : "completed",
        queue: person.queue,
        createdAt: new Date(createdAt).toISOString(),
        updatedAt: new Date(createdAt + 4 * 60_000).toISOString(),
        applicant: { name: person.name, email: person.email, audience: person.audience, artistName: null, city: person.city, age: null, socialLinks: [], musicLinks: [] },
        assessment: {
          suitabilityScore: null, suitabilityBand: null, recommendation: null, confidence: null,
          reportStatus: person.queue === "awaiting_assessment" ? "generating" : null,
          conversationModel: "claude-haiku-5-5", answerCount: person.answers.length,
        },
        decision: null,
      },
      detail: {
        messages: person.answers.flatMap((answer, turn) => [
          { id: `q${turn}`, role: "assistant" as const, content: turn === 0 ? "Why do you want to be an early applicant for the Forum?" : "Tell me a little more about that." },
          { id: `a${turn}`, role: "user" as const, content: answer },
        ]),
        reviewerReport: null,
        details: { city: person.city },
      },
    })
  })
  return records
}

function matches(record: DemoRecord, filters: ApplicationFilters, includeQueue: boolean): boolean {
  const { item } = record
  if (includeQueue && filters.queue !== "all" && item.queue !== filters.queue) return false
  if (filters.audience !== "all" && item.applicant.audience !== filters.audience) return false
  if (filters.recommendation !== "all" && item.assessment.recommendation !== filters.recommendation) return false
  const { min, max } = bandRange(filters.band, POLICY)
  const score = item.assessment.suitabilityScore
  if (min !== null && (score === null || score < min)) return false
  if (max !== null && (score === null || score > max)) return false
  if (filters.from && item.createdAt < `${filters.from}T00:00:00`) return false
  if (filters.to && item.createdAt.slice(0, 10) > filters.to) return false
  const search = filters.search.trim().toLowerCase()
  if (search && ![item.applicant.name, item.applicant.email, item.sessionKey, item.applicant.artistName]
    .some((value) => value?.toLowerCase().includes(search))) return false
  return true
}

function sorted(records: DemoRecord[], sort: ApplicationFilters["sort"]): DemoRecord[] {
  const copy = [...records]
  if (sort === "suitability") {
    return copy.sort((a, b) => (b.item.assessment.suitabilityScore ?? -1) - (a.item.assessment.suitabilityScore ?? -1) || b.item.createdAt.localeCompare(a.item.createdAt))
  }
  if (sort === "newest") return copy.sort((a, b) => b.item.createdAt.localeCompare(a.item.createdAt))
  if (sort === "oldest") return copy.sort((a, b) => a.item.createdAt.localeCompare(b.item.createdAt))
  return copy.sort((a, b) => a.item.updatedAt.localeCompare(b.item.updatedAt))
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value)
  return `"${(/^[=+\-@]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`
}

/** An in-memory source over the sample project. Each call to this function starts a fresh demo. */
export function demoSource(now = Date.now()): ApplicationsSource {
  const records = build(now)
  return {
    async list(filters) {
      const queues: QueueKey[] = ["ready_for_review", "awaiting_assessment", "in_progress", "approved", "declined", "abandoned"]
      const shared = records.filter((record) => matches(record, filters, false))
      const counts = Object.fromEntries(queues.map((queue) => [queue, shared.filter((record) => record.item.queue === queue).length])) as Record<QueueKey, number>
      counts.all = shared.length
      const visible = sorted(records.filter((record) => matches(record, filters, true)), filters.sort)
      const pending = records.filter((record) => record.item.queue === "ready_for_review")
      const decided = records.filter((record) => record.item.decision?.decidedAt)
      const hours = decided.map((record) => (Date.parse(record.item.decision!.decidedAt!) - Date.parse(record.item.updatedAt)) / HOUR).sort((a, b) => a - b)
      const middle = hours.length ? (hours.length % 2 ? hours[(hours.length - 1) / 2] : (hours[hours.length / 2 - 1] + hours[hours.length / 2]) / 2) : null
      return {
        applications: visible.slice(filters.offset, filters.offset + PAGE_SIZE).map((record) => record.item),
        total: visible.length,
        counts,
        metrics: {
          awaitingReview: pending.length,
          oldestPendingSince: pending.map((record) => record.item.updatedAt).sort()[0] ?? null,
          decidedLast7Days: decided.filter((record) => Date.parse(record.item.decision!.decidedAt!) > now - 7 * 24 * HOUR).length,
          medianHoursToDecision: middle === null ? null : Math.round(middle * 10) / 10,
        },
        policy: POLICY,
      } satisfies ApplicationsPage
    },
    async detail(application) {
      const record = records.find((candidate) => candidate.item.id === application.id)
      if (!record) throw new Error("Sample application not found")
      return record.detail
    },
    async decide(application, decision, reason) {
      const record = records.find((candidate) => candidate.item.id === application.id)
      if (!record) throw new Error("Sample application not found")
      if (record.item.decision) throw new Error("A decision has already been recorded")
      if (decision === "declined" && !reason.trim()) throw new Error("A reason is required when declining an application")
      record.item = {
        ...record.item,
        queue: decision,
        decision: { decision, source: "human", reviewer: "you (sample)", reason: reason.trim() || null, decidedAt: new Date().toISOString() },
      }
    },
    async exportCsv(filters) {
      const rows = sorted(records.filter((record) => matches(record, filters, true)), filters.sort)
      const header = ["name", "email", "applicant_type", "queue", "submitted_at", "suitability_score", "recommendation", "decision", "decision_reason"]
      const lines = rows.map(({ item }) => [
        item.applicant.name, item.applicant.email, item.applicant.audience, item.queue, item.createdAt,
        item.assessment.suitabilityScore, item.assessment.recommendation, item.decision?.decision, item.decision?.reason,
      ].map(csvCell).join(","))
      return { filename: `sample-applications-${filters.queue}.csv`, csv: [header.map(csvCell).join(","), ...lines].join("\n") }
    },
  }
}
