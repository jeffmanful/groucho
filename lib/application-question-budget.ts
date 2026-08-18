export const DEFAULT_APPLICATION_QUESTION_LIMIT = 9
export const DEFAULT_ADAPTIVE_TURN_LIMIT = 3

export type ApplicationQuestionPhase =
  | "explore"
  | "closing"
  | "final_probe"
  | "hard_stop"

export type ApplicationQuestionBudget = {
  maxQuestions: number
  answeredQuestions: number
  remainingQuestions: number
  phase: ApplicationQuestionPhase
  adaptiveTurnLimit: number
  adaptiveTurnsUsed: number
  adaptiveTurnsRemaining: number
}

export function applicationQuestionBudget(input: {
  answeredQuestions: number
  maxQuestions?: number
  adaptiveTurnsUsed: number
}): ApplicationQuestionBudget {
  const maxQuestions = Math.max(
    1,
    Math.min(
      DEFAULT_APPLICATION_QUESTION_LIMIT,
      Math.floor(input.maxQuestions ?? DEFAULT_APPLICATION_QUESTION_LIMIT),
    ),
  )
  const answeredQuestions = Math.max(0, Math.floor(input.answeredQuestions))
  const remainingQuestions = Math.max(0, maxQuestions - answeredQuestions)
  const phase: ApplicationQuestionPhase =
    remainingQuestions === 0
      ? "hard_stop"
      : remainingQuestions === 1
        ? "final_probe"
        : remainingQuestions === 2
          ? "closing"
          : "explore"
  const adaptiveTurnsUsed = Math.max(0, Math.floor(input.adaptiveTurnsUsed))
  return {
    maxQuestions,
    answeredQuestions,
    remainingQuestions,
    phase,
    adaptiveTurnLimit: DEFAULT_ADAPTIVE_TURN_LIMIT,
    adaptiveTurnsUsed,
    adaptiveTurnsRemaining: Math.max(
      0,
      DEFAULT_ADAPTIVE_TURN_LIMIT - adaptiveTurnsUsed,
    ),
  }
}
