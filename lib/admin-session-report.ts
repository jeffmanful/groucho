import { COLORS_FORUM_MEMBERSHIP_REPORT_VERSION, normaliseReviewerReport, type ReviewerReport } from "@/lib/reviewer-report"
import { isColorsThinSession } from "@/lib/colors-engine"

export const COLORS_ASSESSMENT_LEASE_MS = 5 * 60_000

type ReportMessage = {
  role: string
  metadata: unknown
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** Metadata for the reviewer UI; no assessment work is triggered by reading a transcript. */
export function adminSessionAssessment(messages: ReportMessage[], concluded: boolean) {
  const supported = concluded && isColorsThinSession(messages)
  const lastAssistant = [...messages].reverse().find(message => message.role === "assistant")
  const metadata = record(lastAssistant?.metadata)
  const report = normaliseReviewerReport(metadata?.reviewer_report)
  const status = metadata?.colors_demo_report_status
  const startedAt = typeof metadata?.colors_demo_report_started_at === "number" ? metadata.colors_demo_report_started_at : 0
  const generating = status === "generating" && Date.now() - startedAt < COLORS_ASSESSMENT_LEASE_MS
  return {
    supported,
    status: status === "ready" && report?.detailed_opinion
      ? report.report_version === COLORS_FORUM_MEMBERSHIP_REPORT_VERSION ? "ready" as const : "outdated" as const
      : generating ? "generating" as const : status === "failed" ? "failed" as const : "pending" as const,
  }
}

/** Prefer the report updated on the terminal message after the completion verdict was saved. */
export function adminSessionReviewerReport(
  messages: ReportMessage[],
  verdictReport: unknown,
): ReviewerReport | null {
  let latestMessageReport: ReviewerReport | null = null
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== "assistant") continue
    const report = normaliseReviewerReport(record(message.metadata)?.reviewer_report)
    if (!report) continue
    if (report.detailed_opinion) return report
    latestMessageReport ??= report
  }

  const verdict = normaliseReviewerReport(verdictReport)
  return verdict?.detailed_opinion ? verdict : latestMessageReport ?? verdict
}
