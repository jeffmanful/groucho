import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase", () => ({ supabase: {} }))

import {
  applicationFromRow,
  applicationsCsv,
  applySharedFilters,
  cleanSearch,
  median,
  parseApplicationQueueFilters,
  withBand,
  type QueueRow,
} from "@/lib/application-queue"

class FakeQuery {
  calls: Array<[string, ...unknown[]]> = []
  eq(column: string, value: unknown) { this.calls.push(["eq", column, value]); return this }
  gte(column: string, value: unknown) { this.calls.push(["gte", column, value]); return this }
  lte(column: string, value: unknown) { this.calls.push(["lte", column, value]); return this }
  lt(column: string, value: unknown) { this.calls.push(["lt", column, value]); return this }
  or(filters: string) { this.calls.push(["or", filters]); return this }
}

const row: QueueRow = {
  id: "app-1", session_id: "client-1", status: "completed", created_at: "2026-10-20T10:00:00Z",
  updated_at: "2026-10-20T10:06:00Z", applicant_email: "ada@example.test", applicant_name: "Ada",
  applicant_details: { city: "London", age: 27, artistName: "ADA", socialLinks: [], musicLinks: [] },
  application_audience: "artist", suitability_score: 0.834, decision: null, decision_source: null,
  reviewer_kind: null, reviewer_email: null, decision_reason: null, decided_at: null,
  recommendation: "recommend", confidence: 0.78, report_status: "ready", conversation_model: "claude-haiku-5-5",
  answer_count: 4, queue: "ready_for_review",
}

describe("application review queue", () => {
  it("defaults to the ready-for-review queue sorted by suitability", () => {
    const filters = parseApplicationQueueFilters(new URLSearchParams())
    expect(filters).toMatchObject({ queue: "ready_for_review", audience: "all", sort: "suitability", offset: 0, limit: 50 })
  })

  it("parses and bounds every filter", () => {
    const filters = parseApplicationQueueFilters(new URLSearchParams({
      queue: "approved", audience: "artist", recommendation: "decline", minScore: "-1", maxScore: "0.7",
      from: "2026-10-01", to: "2026-10-26", q: "ada", sort: "oldest", offset: "100", limit: "5000",
    }))
    expect(filters).toMatchObject({
      queue: "approved", audience: "artist", recommendation: "decline", minScore: 0, maxScore: 0.7,
      from: "2026-10-01", to: "2026-10-26", search: "ada", sort: "oldest", offset: 100, limit: 100,
    })
  })

  it("ignores unknown or malformed values", () => {
    const filters = parseApplicationQueueFilters(new URLSearchParams({
      queue: "passed", audience: "vip", sort: "random", from: "26/10/2026", minScore: "high",
    }))
    expect(filters).toMatchObject({ queue: "ready_for_review", audience: "all", sort: "suitability", from: null, minScore: null })
  })

  it("strips characters that would change the search filter", () => {
    expect(cleanSearch("ada),status.eq.approved*")).toBe("ada status.eq.approved")
    expect(cleanSearch("  a   b ")).toBe("a b")
  })

  it("applies audience, recommendation, score, date and search filters", () => {
    const query = new FakeQuery()
    applySharedFilters(query, parseApplicationQueueFilters(new URLSearchParams({
      audience: "community", recommendation: "recommend", minScore: "0.6", maxScore: "0.9",
      from: "2026-10-01", to: "2026-10-26", q: "ada",
    })))
    expect(query.calls).toEqual([
      ["eq", "application_audience", "community"],
      ["eq", "recommendation", "recommend"],
      ["gte", "suitability_score", 0.6],
      ["lte", "suitability_score", 0.9],
      ["gte", "created_at", "2026-10-01T00:00:00Z"],
      ["lt", "created_at", "2026-10-27T00:00:00.000Z"],
      ["or", "applicant_email.ilike.*ada*,applicant_name.ilike.*ada*,session_id.ilike.*ada*"],
    ])
  })

  it("adds nothing when no filters are set", () => {
    const query = new FakeQuery()
    applySharedFilters(query, parseApplicationQueueFilters(new URLSearchParams()))
    expect(query.calls).toEqual([])
  })

  it("shapes a row for the dashboard", () => {
    expect(applicationFromRow(row)).toMatchObject({
      id: "app-1", queue: "ready_for_review",
      applicant: { name: "Ada", audience: "artist", artistName: "ADA", city: "London" },
      assessment: { suitabilityScore: 0.834, recommendation: "recommend", confidence: 0.78, answerCount: 4 },
      decision: null,
    })
    expect(applicationFromRow({ ...row, decision: "approved", decision_source: "human", reviewer_email: "r@example.test", decided_at: "2026-10-21T09:00:00Z" }).decision)
      .toEqual({ decision: "approved", source: "human", reviewer: "r@example.test", reason: null, decidedAt: "2026-10-21T09:00:00Z" })
  })

  it("exports quoted CSV and neutralises spreadsheet formulas", () => {
    const csv = applicationsCsv([{ ...row, applicant_name: "=HYPERLINK(\"x\")", decision_reason: "Said \"yes\", twice" }])
    const [header, line] = csv.split("\n")
    expect(header.startsWith("\"application_id\",\"client_session_key\",\"queue\"")).toBe(true)
    expect(line).toContain("\"'=HYPERLINK(\"\"x\"\")\"")
    expect(line).toContain("\"artist\"")
  })

  it("computes a median", () => {
    expect(median([])).toBeNull()
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })

  it("turns a suitability band into a score range under the project's thresholds", () => {
    const base = parseApplicationQueueFilters(new URLSearchParams())
    const policy = { acceptanceThreshold: 0.75, reviewThreshold: 0.5 }
    expect(withBand(base, "recommended_acceptance", policy)).toMatchObject({ minScore: 0.75, maxScore: null })
    expect(withBand(base, "review", policy)).toMatchObject({ minScore: 0.5, maxScore: 0.7499 })
    expect(withBand(base, "below_threshold", policy)).toMatchObject({ minScore: null, maxScore: 0.4999 })
    expect(withBand(base, "nonsense", policy)).toBe(base)
    expect(withBand({ ...base, minScore: 0.6 }, "review", policy).minScore).toBe(0.6)
  })
})
