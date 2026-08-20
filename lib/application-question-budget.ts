export const DEFAULT_APPLICATION_SOFT_TARGET = 9
export const MAX_APPLICATION_EMERGENCY_LIMIT = 14
export const EMERGENCY_TURN_ALLOWANCE = 3

export type ApplicationQuestionPhase =
  | "explore"
  | "consider_close"
  | "emergency_stop"

export type ApplicationQuestionBudget = {
  /** Compatibility alias for emergencyLimit. */
  maxQuestions: number
  softTarget: number
  emergencyLimit: number
  answeredQuestions: number
  /** Questions remaining before the emergency loop stop, not a conversational target. */
  remainingQuestions: number
  phase: ApplicationQuestionPhase
}

export function applicationQuestionBudget(input: {
  answeredQuestions: number
  maxQuestions?: number
}): ApplicationQuestionBudget {
  const softTarget = Math.max(
    1,
    Math.min(
      12,
      Math.floor(input.maxQuestions ?? DEFAULT_APPLICATION_SOFT_TARGET),
    ),
  )
  const emergencyLimit = Math.min(
    MAX_APPLICATION_EMERGENCY_LIMIT,
    softTarget + EMERGENCY_TURN_ALLOWANCE,
  )
  const answeredQuestions = Math.max(0, Math.floor(input.answeredQuestions))
  const remainingQuestions = Math.max(0, emergencyLimit - answeredQuestions)
  const phase: ApplicationQuestionPhase =
    remainingQuestions === 0
      ? "emergency_stop"
      : answeredQuestions >= softTarget
        ? "consider_close"
        : "explore"
  return {
    maxQuestions: emergencyLimit,
    softTarget,
    emergencyLimit,
    answeredQuestions,
    remainingQuestions,
    phase,
  }
}
