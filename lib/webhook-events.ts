// Events a project webhook can subscribe to. Safe to import from client components.
export const WEBHOOK_EVENTS = [
  "session.completed",
  "application.decided",
  "application.decision_corrected",
  "application.allocated",
  "cohort.locked",
  "cohort.drawn",
] as const
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, { name: string; description: string }> = {
  "session.completed": {
    name: "Application finished",
    description: "When an applicant's conversation ends, with Groucho's assessment.",
  },
  "application.decided": {
    name: "Application decided",
    description: "When anyone approves or declines — in the dashboard, your app or your policy.",
  },
  "application.decision_corrected": {
    name: "Decision corrected",
    description: "When your team corrects a decision. The new decision replaces the old one.",
  },
  "application.allocated": {
    name: "Placed in a cohort",
    description: "When someone is added to, moved between or removed from cohorts, including by a draw.",
  },
  "cohort.locked": {
    name: "Cohort locked",
    description: "When a cohort is frozen, for example before a ballot.",
  },
  "cohort.drawn": {
    name: "Draw completed",
    description: "When Groucho draws winners from a locked cohort.",
  },
}

/** A non-empty list of known events, without duplicates, or null when the input is not that. */
export function parseWebhookEvents(value: unknown): WebhookEvent[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  if (!value.every((event): event is WebhookEvent => (WEBHOOK_EVENTS as readonly unknown[]).includes(event))) return null
  return WEBHOOK_EVENTS.filter((event) => value.includes(event))
}

export const DECISION_EVENTS = {
  decided: "application.decided",
  corrected: "application.decision_corrected",
} as const
export type DecisionEvent = (typeof DECISION_EVENTS)[keyof typeof DECISION_EVENTS]
export const DECISION_EVENT = DECISION_EVENTS.decided

export function isDecisionEvent(value: unknown): value is DecisionEvent {
  return value === DECISION_EVENTS.decided || value === DECISION_EVENTS.corrected
}


export const ALLOCATION_EVENT = "application.allocated" as const
export const COHORT_EVENTS = { locked: "cohort.locked", drawn: "cohort.drawn" } as const
export type CohortEvent = (typeof COHORT_EVENTS)[keyof typeof COHORT_EVENTS]
export function isCohortEvent(value: unknown): value is CohortEvent {
  return value === COHORT_EVENTS.locked || value === COHORT_EVENTS.drawn
}
