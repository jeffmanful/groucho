export const APPLICATION_ANSWER_RELATIONS = [
  "direct",
  "partial",
  "subject_shift",
  "ambiguous",
] as const

export type ApplicationAnswerRelationKind =
  (typeof APPLICATION_ANSWER_RELATIONS)[number]

export type ApplicationAnswerRelation = {
  kind: ApplicationAnswerRelationKind
  reason: string
}

const RELATION_SET = new Set<string>(APPLICATION_ANSWER_RELATIONS)

export function normaliseApplicationAnswerRelation(
  raw: unknown,
): ApplicationAnswerRelation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (typeof value.kind !== "string" || !RELATION_SET.has(value.kind)) {
    return null
  }
  return {
    kind: value.kind as ApplicationAnswerRelationKind,
    reason:
      typeof value.reason === "string" ? value.reason.trim().slice(0, 240) : "",
  }
}

export function applicationAnswerNeedsRepair(
  relation: ApplicationAnswerRelation | null,
): boolean {
  return relation?.kind === "subject_shift" || relation?.kind === "ambiguous"
}
