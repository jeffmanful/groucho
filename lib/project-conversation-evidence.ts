import type { ProjectConversationSignal } from "@/lib/project-conversation-config"

export type SignalEvidenceStatus = "evidence_found" | "partly_understood" | "not_explored" | "declined"
export type SignalEvidence = {
  status: SignalEvidenceStatus
  summary: string
  reason: string
  sources: Array<{ quote: string; turn: number }>
}
export type SignalEvidenceMap = Record<string, SignalEvidence>
export const SIGNAL_EVIDENCE_LABELS: Record<SignalEvidenceStatus, string> = {
  evidence_found: "Evidence found", partly_understood: "Partly understood", not_explored: "Not explored", declined: "Declined to share",
}
export function emptySignalEvidence(signals: readonly ProjectConversationSignal[]): SignalEvidenceMap {
  return Object.fromEntries(signals.map(signal => [signal.id, { status: "not_explored", summary: "", reason: "", sources: [] }]))
}
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}

/** Quoted evidence is an applicant account, not independent verification or an eligibility score. */
export function mergeSignalEvidence(previous: unknown, updates: unknown, answer: string, turn: number, signals: readonly ProjectConversationSignal[]): SignalEvidenceMap {
  const result = emptySignalEvidence(signals)
  const stored = record(previous)
  for (const signal of signals) {
    const old = record(stored[signal.id])
    if (Object.hasOwn(SIGNAL_EVIDENCE_LABELS, String(old.status)) && Array.isArray(old.sources)) {
      result[signal.id] = { status: old.status as SignalEvidenceStatus, summary: typeof old.summary === "string" ? old.summary : "", reason: typeof old.reason === "string" ? old.reason : "", sources: old.sources.filter(s => typeof s?.quote === "string" && Number.isInteger(s.turn) && s.turn > 0 && s.turn < turn).slice(-4) }
    }
  }
  if (!Array.isArray(updates)) return result
  for (const raw of updates.slice(0, 12)) {
    const update = record(raw)
    if (typeof update.signalId !== "string" || !Object.hasOwn(result, update.signalId) || update.subject !== "applicant" || !Object.hasOwn(SIGNAL_EVIDENCE_LABELS, String(update.status))) continue
    if (typeof update.summary !== "string" || update.summary.length > 600 || typeof update.reason !== "string" || update.reason.length > 1000 || typeof update.supersedes !== "boolean" || !Array.isArray(update.quotes)) continue
    // Reject the whole update when any proposed quote is unsupported; do not launder mixed evidence.
    if (!update.quotes.length || update.quotes.length > 3 || update.quotes.some(q => typeof q !== "string" || !q.trim() || q.length > 1000 || !answer.includes(q))) continue
    const old = result[update.signalId]
    const sources = [...(update.supersedes || update.status === "declined" ? [] : old.sources), ...update.quotes.map((quote: string) => ({ quote, turn }))]
    const unique = sources.filter((source, i) => sources.findIndex(s => s.quote === source.quote && s.turn === source.turn) === i).slice(-4)
    result[update.signalId] = { status: update.status as SignalEvidenceStatus, summary: update.summary.trim(), reason: update.reason.trim(), sources: unique }
  }
  return result
}
