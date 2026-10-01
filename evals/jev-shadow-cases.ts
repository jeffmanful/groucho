import { COLORS_RECOMMEND_CALIBRATION_CASES } from "@/evals/colors-reviewer-calibration"
import type { AdvisoryRecommendation } from "@/lib/reviewer-report"

export type JevShadowCase = {
  id: string
  expectedRecommendation: AdvisoryRecommendation
  expectedOrientation: "artist" | "curator" | "enthusiast" | "hybrid" | "unknown"
  expectedRisk: "none" | "insufficient_evidence" | "fabrication" | "extractive_intent" | "consent_violation"
  applicantEvidence: readonly string[]
  neutralMissingInformation: readonly string[]
}

const positiveCases: JevShadowCase[] = COLORS_RECOMMEND_CALIBRATION_CASES.map(
  (calibrationCase) => ({
    id: calibrationCase.id,
    expectedRecommendation: calibrationCase.expectedRecommendation,
    expectedOrientation: calibrationCase.expectedOrientation,
    expectedRisk: "none",
    applicantEvidence: calibrationCase.applicantEvidence,
    neutralMissingInformation: calibrationCase.neutralMissingInformation,
  }),
)

const boundaryCases: JevShadowCase[] = [
  {
    id: "persistently-vague",
    expectedRecommendation: "human_review",
    expectedOrientation: "enthusiast",
    expectedRisk: "insufficient_evidence",
    applicantEvidence: [
      "I just want to see what is there.",
      "I like COLORS.",
      "There are loads of artists. I cannot think of one right now.",
      "I mostly listen.",
      "I do not know what I would contribute yet.",
    ],
    neutralMissingInformation: [],
  },
  {
    id: "admitted-fabrication",
    expectedRecommendation: "human_review",
    expectedOrientation: "enthusiast",
    expectedRisk: "fabrication",
    applicantEvidence: [
      "I said I run a weekly listening group, but I do not actually host anything or share music regularly.",
      "I said it because it sounded like what you wanted.",
      "I mostly listen.",
    ],
    neutralMissingInformation: [],
  },
  {
    id: "repeated-extractive-intent",
    expectedRecommendation: "human_review",
    expectedOrientation: "curator",
    expectedRisk: "extractive_intent",
    applicantEvidence: [
      "I want direct access to emerging artists before everyone else so I can grow my platform.",
      "I watch which local artists are gaining attention so I can contact them first.",
      "I package discoveries quickly so my account becomes associated with an artist before other curators find them.",
      "I am less interested if there is no momentum behind them.",
    ],
    neutralMissingInformation: [],
  },
  {
    id: "artist-consent-violation",
    expectedRecommendation: "decline",
    expectedOrientation: "curator",
    expectedRisk: "consent_violation",
    applicantEvidence: [
      "I often receive private works in progress.",
      "If an artist sends me an unfinished demo privately, I post a clip without asking.",
      "I would keep posting it even if the artist objected because I think the exposure outweighs their hesitation.",
    ],
    neutralMissingInformation: [],
  },
]

export const JEV_SHADOW_CASES: readonly JevShadowCase[] = [
  ...positiveCases,
  ...boundaryCases,
]

