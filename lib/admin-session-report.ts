import { normaliseReviewerReport, type ReviewerReport } from "@/lib/reviewer-report"

type ReportMessage = {
  role: string
  metadata: unknown
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
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
