import type { OnboardingFlowStep } from "@/lib/project-settings"
import { defaultOnboardingSteps } from "@/lib/project-settings"

/** COLORS forum onboarding — see COLORS_PERSONA_SPEC.md */
export const COLORS_ONBOARDING_STEPS: OnboardingFlowStep[] = [
  {
    id: "intent",
    title: "Intent",
    question: "What draws you to COLORS, beyond discovering new music?",
    profile_key: "intent",
    required: true,
  },
  {
    id: "creative_relationship",
    title: "Creative Relationship",
    question: "What kind of creative expression tends to stay with you, and why?",
    profile_key: "creative_relationship",
    required: true,
  },
  {
    id: "community_care",
    title: "Community Care",
    question:
      "When you enter a creative community, what do you think people should protect for each other?",
    profile_key: "community_care",
    required: true,
  },
  {
    id: "belonging",
    title: "Belonging",
    question: "What helps you feel safe, respected, and able to show up as yourself?",
    profile_key: "belonging",
    required: true,
  },
  {
    id: "contribution",
    title: "Contribution",
    question:
      "How would you want to contribute to the COLORS world without adding noise?",
    profile_key: "contribution",
    required: true,
  },
]

export type OnboardingFlowPreset = {
  id: string
  label: string
  description: string
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
    label: "COLORS forum (5 questions)",
    description: "Recommended flow from COLORS_PERSONA_SPEC.md.",
    steps: COLORS_ONBOARDING_STEPS,
  },
]
