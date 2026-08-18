export const CONCLUDED_SESSION_STATUSES = [
  "passed",
  "failed",
  "redirected",
  "rejected",
  "abandoned",
] as const

export type ConcludedSessionStatus = (typeof CONCLUDED_SESSION_STATUSES)[number]

export function isConcludedSessionStatus(
  status: string | null | undefined,
): status is ConcludedSessionStatus {
  return CONCLUDED_SESSION_STATUSES.includes(status as ConcludedSessionStatus)
}
