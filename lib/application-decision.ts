import type { AdminActor } from "@/lib/admin-actor"

export const HUMAN_APPLICATION_DECISIONS = ["approved", "declined"] as const

export type HumanApplicationDecision =
  (typeof HUMAN_APPLICATION_DECISIONS)[number]

export type ApplicationReviewStatus =
  | "not_ready"
  | "pending"
  | "approved"
  | "declined"

export type StoredApplicationDecision = {
  decision?: unknown
  access_secret?: unknown
}

export function parseHumanApplicationDecision(
  value: unknown,
): HumanApplicationDecision | null {
  return value === "approved" || value === "declined" ? value : null
}

export function applicationDecisionActor(actor: AdminActor): {
  reviewer_kind: "platform" | "member"
  reviewer_user_id: string | null
  reviewer_email: string | null
} {
  return actor.kind === "platform"
    ? {
        reviewer_kind: "platform",
        reviewer_user_id: null,
        reviewer_email: actor.email,
      }
    : {
        reviewer_kind: "member",
        reviewer_user_id: actor.userId,
        reviewer_email: actor.email,
      }
}

export function applicationReviewStatus(input: {
  concluded: boolean
  decision?: StoredApplicationDecision | null
}): ApplicationReviewStatus {
  if (input.decision?.decision === "approved") return "approved"
  if (input.decision?.decision === "declined") return "declined"
  return input.concluded ? "pending" : "not_ready"
}

export function humanDecisionGrantsAccess(
  decision: StoredApplicationDecision | null | undefined,
  suppliedSecret: string | null | undefined,
): boolean {
  return (
    decision?.decision === "approved" &&
    typeof decision.access_secret === "string" &&
    decision.access_secret.length > 0 &&
    typeof suppliedSecret === "string" &&
    suppliedSecret.length > 0 &&
    decision.access_secret === suppliedSecret
  )
}
