// Outcomes a client reports after a decision. Safe to import from client components.
export const APPLICATION_OUTCOMES = [
  "invited",
  "joined",
  "invite_declined",
  "no_response",
  "active",
  "inactive",
  "left",
  "removed",
] as const
export type ApplicationOutcome = (typeof APPLICATION_OUTCOMES)[number]

export const OUTCOME_LABELS: Record<ApplicationOutcome, string> = {
  invited: "Invited",
  joined: "Joined",
  invite_declined: "Declined the invite",
  no_response: "No response",
  active: "Active",
  inactive: "Inactive",
  left: "Left",
  removed: "Removed",
}
