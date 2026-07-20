import type { OnboardingFlowStep } from "@/lib/project-settings"
import { defaultOnboardingSteps } from "@/lib/project-settings"
import { COLORS_DEFAULT_WELCOME } from "@/lib/onboarding-persona-template"

/** COLORS forum application intake — static, lightweight flow; see COLORS_PERSONA_SPEC.md */
export const COLORS_ONBOARDING_STEPS: OnboardingFlowStep[] = [
  {
    id: "intent",
    title: "Intent",
    question: "What brought you here?",
    profile_key: "intent",
    required: true,
    interaction: {
      inputType: "singleSelect",
      options: ["Discover", "Community", "Share Work"],
    },
  },
  {
    id: "artist_reference",
    title: "Artist Reference",
    question:
      "Name an artist more people should know about. What would you want someone hearing them for the first time to notice?",
    profile_key: "artist_reference",
    required: true,
    min_answer_chars: 18,
  },
  {
    id: "recommendation",
    title: "Recommendation",
    question:
      "What's the last song you recommended, and why did you think it was worth sharing?",
    profile_key: "recommendation",
    required: true,
    min_answer_chars: 18,
  },
  {
    id: "community_value",
    title: "Community Value",
    question:
      "Someone shares unfinished music that isn't really for you. How would you respond?",
    profile_key: "community_value",
    required: true,
    min_answer_chars: 18,
  },
  {
    id: "participation_style",
    title: "Participation Style",
    question: "Which sounds most like you?",
    profile_key: "participation_style",
    required: true,
    interaction: {
      inputType: "singleSelect",
      options: [
        "I mostly listen",
        "I like discussing music",
        "I enjoy giving feedback",
        "I regularly share discoveries",
      ],
    },
  },
  {
    id: "forum_contribution",
    title: "Forum Contribution",
    question:
      "What's one thing you could realistically contribute in your first month?",
    profile_key: "forum_contribution",
    required: true,
    min_answer_chars: 18,
  },
]

export type OnboardingFlowPreset = {
  id: string
  label: string
  description: string
  welcome_message?: string
  steps: OnboardingFlowStep[]
}

export const ONBOARDING_FLOW_PRESETS: OnboardingFlowPreset[] = [
  {
    id: "default",
    label: "Starter (3 questions)",
    description: "Intent, interests, and values.",
    steps: defaultOnboardingSteps(),
  },
  {
    id: "colors",
    label: "COLORS forum application (6 inputs)",
    description: "Static intake flow for early COLORS forum applications.",
    welcome_message: COLORS_DEFAULT_WELCOME,
    steps: COLORS_ONBOARDING_STEPS,
  },
]
