export type JevTurnRelation = "direct" | "partial" | "subject_shift" | "ambiguous"
export type JevTurnQuality = "thin" | "usable" | "rich" | "concerning"
export type JevTurnAction = "clarify" | "follow_thread" | "advance" | "challenge" | "close"
export type JevTurnRisk = "none" | "fabrication" | "extractive_intent" | "consent_violation"

export type JevTurnSignal = {
  key: string
  label: string
  goal: string
}

export type JevTurnRoutingCase = {
  id: string
  currentQuestion: string
  currentAnswer: string
  currentSignalKey: string
  priorCoveredSignalKeys: readonly string[]
  allowClose: boolean
  expected: {
    relation: JevTurnRelation
    quality: JevTurnQuality
    coveredSignalKeys: readonly string[]
    action: JevTurnAction
    nextSignalKey: string | null
    fastClose: boolean
    risk: JevTurnRisk
  }
}

export const JEV_TURN_SIGNALS: readonly JevTurnSignal[] = [
  {
    key: "colors_relationship",
    label: "Relationship to COLORS",
    goal: "Why COLORS specifically matters to them and what they believe the Forum could extend.",
  },
  {
    key: "cultural_point_of_view",
    label: "Cultural point of view",
    goal: "A specific creative reference accompanied by personal context or judgment.",
  },
  {
    key: "participation_and_contribution",
    label: "Participation and contribution",
    goal: "A concrete, realistic behavior they already sustain or could contribute to the Forum.",
  },
  {
    key: "care_and_feedback",
    label: "Care and feedback",
    goal: "How they respond to unfinished work with consent, care, honesty, and respect for artistic intent.",
  },
]

export const JEV_TURN_ROUTING_CASES: readonly JevTurnRoutingCase[] = [
  {
    id: "direct-rich-multi-signal",
    currentQuestion: "Why do you want to be an early applicant for the Forum?",
    currentAnswer: "COLORS gives unfamiliar artists context without explaining them away. I want that attention to continue in the Forum, and I already host a monthly listening night where quieter work gets patient discussion.",
    currentSignalKey: "colors_relationship",
    priorCoveredSignalKeys: [],
    allowClose: false,
    expected: {
      relation: "direct",
      quality: "rich",
      coveredSignalKeys: ["colors_relationship", "participation_and_contribution"],
      action: "advance",
      nextSignalKey: "cultural_point_of_view",
      fastClose: false,
      risk: "none",
    },
  },
  {
    id: "direct-cultural-judgment",
    currentQuestion: "Tell me about an artist more people should spend real time with.",
    currentAnswer: "Mabe Fratti. Her cello can feel fragile and confrontational at once, and people often flatten that tension into genre.",
    currentSignalKey: "cultural_point_of_view",
    priorCoveredSignalKeys: ["colors_relationship"],
    allowClose: false,
    expected: {
      relation: "direct",
      quality: "rich",
      coveredSignalKeys: ["cultural_point_of_view"],
      action: "advance",
      nextSignalKey: "participation_and_contribution",
      fastClose: false,
      risk: "none",
    },
  },
  {
    id: "direct-thin-needs-clarification",
    currentQuestion: "What could you realistically contribute in your first month?",
    currentAnswer: "I am not sure. Maybe I would join some chats.",
    currentSignalKey: "participation_and_contribution",
    priorCoveredSignalKeys: ["colors_relationship", "cultural_point_of_view"],
    allowClose: false,
    expected: {
      relation: "direct",
      quality: "thin",
      coveredSignalKeys: [],
      action: "clarify",
      nextSignalKey: "participation_and_contribution",
      fastClose: false,
      risk: "none",
    },
  },
  {
    id: "partial-contribution-follow-up",
    currentQuestion: "What would you contribute in your first month, and what part could you sustain?",
    currentAnswer: "I could post a focused playlist with notes during the first week.",
    currentSignalKey: "participation_and_contribution",
    priorCoveredSignalKeys: ["colors_relationship", "cultural_point_of_view"],
    allowClose: false,
    expected: {
      relation: "partial",
      quality: "usable",
      coveredSignalKeys: ["participation_and_contribution"],
      action: "follow_thread",
      nextSignalKey: "participation_and_contribution",
      fastClose: false,
      risk: "none",
    },
  },
  {
    id: "subject-shift-repair",
    currentQuestion: "How do you respond when unfinished work is not naturally for you?",
    currentAnswer: "I produce electronic soul and I am looking for collaborators.",
    currentSignalKey: "care_and_feedback",
    priorCoveredSignalKeys: ["colors_relationship"],
    allowClose: false,
    expected: {
      relation: "subject_shift",
      quality: "usable",
      coveredSignalKeys: [],
      action: "clarify",
      nextSignalKey: null,
      fastClose: false,
      risk: "none",
    },
  },
  {
    id: "ambiguous-repair",
    currentQuestion: "Why does COLORS feel like the right community for you?",
    currentAnswer: "That depends on what people bring to it.",
    currentSignalKey: "colors_relationship",
    priorCoveredSignalKeys: [],
    allowClose: false,
    expected: {
      relation: "ambiguous",
      quality: "thin",
      coveredSignalKeys: [],
      action: "clarify",
      nextSignalKey: null,
      fastClose: false,
      risk: "none",
    },
  },
  {
    id: "consent-boundary-challenge",
    currentQuestion: "How would you handle an unfinished demo shared with you privately?",
    currentAnswer: "I post a clip without asking because the exposure helps. I would keep it up even if the artist objected.",
    currentSignalKey: "care_and_feedback",
    priorCoveredSignalKeys: ["colors_relationship", "cultural_point_of_view"],
    allowClose: true,
    expected: {
      relation: "direct",
      quality: "concerning",
      coveredSignalKeys: ["care_and_feedback"],
      action: "challenge",
      nextSignalKey: "care_and_feedback",
      fastClose: false,
      risk: "consent_violation",
    },
  },
  {
    id: "extractive-boundary-challenge",
    currentQuestion: "Why do you want to join this particular Forum?",
    currentAnswer: "I want access to emerging artists before everyone else so I can grow my platform. I am less interested when there is no momentum behind them.",
    currentSignalKey: "colors_relationship",
    priorCoveredSignalKeys: [],
    allowClose: true,
    expected: {
      relation: "direct",
      quality: "concerning",
      coveredSignalKeys: ["colors_relationship"],
      action: "challenge",
      nextSignalKey: "colors_relationship",
      fastClose: false,
      risk: "extractive_intent",
    },
  },
  {
    id: "fabrication-boundary-challenge",
    currentQuestion: "You mentioned hosting a listening group. What is true about how you actually take part?",
    currentAnswer: "I do not host anything. I said I ran a group because it sounded like what you wanted. I mostly listen.",
    currentSignalKey: "participation_and_contribution",
    priorCoveredSignalKeys: ["colors_relationship"],
    allowClose: true,
    expected: {
      relation: "direct",
      quality: "concerning",
      coveredSignalKeys: ["participation_and_contribution"],
      action: "challenge",
      nextSignalKey: "participation_and_contribution",
      fastClose: false,
      risk: "fabrication",
    },
  },
  {
    id: "rich-answer-covers-two-goals",
    currentQuestion: "What could you realistically contribute here?",
    currentAnswer: "I would host a monthly process thread where someone shares a rough section. I would first ask what they want it to become, then respond to that intention before suggesting changes.",
    currentSignalKey: "participation_and_contribution",
    priorCoveredSignalKeys: ["cultural_point_of_view"],
    allowClose: false,
    expected: {
      relation: "direct",
      quality: "rich",
      coveredSignalKeys: ["participation_and_contribution", "care_and_feedback"],
      action: "advance",
      nextSignalKey: "colors_relationship",
      fastClose: false,
      risk: "none",
    },
  },
  {
    id: "terminal-fast-path",
    currentQuestion: "What is one contribution you could realistically sustain here?",
    currentAnswer: "I would run a weekly repeat-listen thread, reply to other members, and return the following week with what changed after listening again.",
    currentSignalKey: "participation_and_contribution",
    priorCoveredSignalKeys: ["colors_relationship", "cultural_point_of_view", "care_and_feedback"],
    allowClose: true,
    expected: {
      relation: "direct",
      quality: "rich",
      coveredSignalKeys: ["participation_and_contribution"],
      action: "close",
      nextSignalKey: null,
      fastClose: true,
      risk: "none",
    },
  },
  {
    id: "terminal-fast-path-blocked-by-thin-answer",
    currentQuestion: "What is one contribution you could realistically sustain here?",
    currentAnswer: "I do not know yet.",
    currentSignalKey: "participation_and_contribution",
    priorCoveredSignalKeys: ["colors_relationship", "cultural_point_of_view", "care_and_feedback"],
    allowClose: true,
    expected: {
      relation: "direct",
      quality: "thin",
      coveredSignalKeys: [],
      action: "clarify",
      nextSignalKey: "participation_and_contribution",
      fastClose: false,
      risk: "none",
    },
  },
  {
    id: "terminal-fast-path-blocked-by-risk",
    currentQuestion: "How would you respond to a private unfinished demo?",
    currentAnswer: "I would post a clip without asking, and I would leave it up even if the artist objected because exposure matters more.",
    currentSignalKey: "care_and_feedback",
    priorCoveredSignalKeys: ["colors_relationship", "cultural_point_of_view", "participation_and_contribution"],
    allowClose: true,
    expected: {
      relation: "direct",
      quality: "concerning",
      coveredSignalKeys: ["care_and_feedback"],
      action: "challenge",
      nextSignalKey: "care_and_feedback",
      fastClose: false,
      risk: "consent_violation",
    },
  },
]

