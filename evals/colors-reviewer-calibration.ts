import type { ApplicationParticipantOrientation } from "@/lib/application-participant-orientation"
import type { AdvisoryRecommendation } from "@/lib/reviewer-report"

export type ColorsReviewerCalibrationCase = {
  id: string
  name: string
  expectedRecommendation: AdvisoryRecommendation
  expectedOrientation: Exclude<ApplicationParticipantOrientation, "unknown">
  applicantEvidence: readonly string[]
  recommendationBasis: readonly string[]
  neutralMissingInformation: readonly string[]
}

/**
 * Client-confirmed positive anchors for reviewer calibration.
 *
 * These are evaluation fixtures, not production prompt copy or mandatory
 * questions. Replays may paraphrase the evidence to answer Groucho's live
 * questions, but the expected judgment and neutral omissions stay fixed.
 */
export const COLORS_RECOMMEND_CALIBRATION_CASES = [
  {
    id: "active-contributor-artist",
    name: "The active contributor",
    expectedRecommendation: "recommend",
    expectedOrientation: "artist",
    applicantEvidence: [
      "I'm a South London producer making sparse electronic R&B. I've released two tracks but have a folder of unfinished demos.",
      "I want honest feedback on arrangement and whether my vocals feel convincing.",
      "I'd contribute by joining listening sessions and giving specific production feedback to other artists.",
    ],
    recommendationBasis: [
      "Has a clear creative identity and a specific reason for joining.",
      "Plans to contribute as well as receive value.",
      "Interest in unfinished work and focused feedback aligns with the Forum's purpose.",
    ],
    neutralMissingInformation: [
      "Audience size",
      "Release links",
      "Professional credits",
    ],
  },
  {
    id: "thoughtful-listener-enthusiast",
    name: "The thoughtful listener",
    expectedRecommendation: "recommend",
    expectedOrientation: "enthusiast",
    applicantEvidence: [
      "I'm not an artist, but I spend a lot of time finding new music through local radio, Bandcamp, and small live nights.",
      "I'd like to share discoveries before they become widely known.",
      "When I name an overlooked artist, I can explain what makes their songwriting distinctive.",
    ],
    recommendationBasis: [
      "Shows genuine curiosity and can articulate taste beyond listing popular artists.",
      "Could add discovery, discussion, and informed encouragement without being a music professional.",
    ],
    neutralMissingInformation: [
      "Community moderation experience",
      "Formal review-writing experience",
    ],
  },
  {
    id: "constructive-specialist-curator",
    name: "The constructive specialist",
    expectedRecommendation: "recommend",
    expectedOrientation: "curator",
    applicantEvidence: [
      "I run a monthly playlist focused on alternative African electronic music, usually featuring 15–20 independent artists.",
      "When giving feedback, I separate personal taste from whether the artist's idea is coming through clearly.",
      "I recently introduced two artists who later worked on a track together.",
    ],
    recommendationBasis: [
      "Has a specific curatorial focus and a constructive feedback philosophy.",
      "Already creates useful connections between artists.",
      "Demonstrates behaviour and consequence rather than relying on status claims.",
    ],
    neutralMissingInformation: [
      "Playlist follower count",
      "Industry affiliations",
    ],
  },
  {
    id: "community-minded-emerging-artist-hybrid",
    name: "The community-minded emerging artist",
    expectedRecommendation: "recommend",
    expectedOrientation: "hybrid",
    applicantEvidence: [
      "I make music, photograph local shows, and help organise a small open-mic night in Manchester.",
      "I'm joining to meet artists outside my immediate scene and get feedback on works in progress.",
      "I could contribute photos, recommend performers, and help make new members feel included.",
    ],
    recommendationBasis: [
      "Can participate by creating, documenting, discovering, and welcoming.",
      "Offers concrete contribution rooted in an existing local community.",
    ],
    neutralMissingInformation: [
      "Preferred genre",
      "Current project details",
    ],
  },
  {
    id: "early-stage-intentional-artist",
    name: "The early-stage but intentional artist",
    expectedRecommendation: "recommend",
    expectedOrientation: "artist",
    applicantEvidence: [
      "I've only been making music seriously for eight months and haven't released anything yet.",
      "I'm trying to turn voice notes and rough loops into complete songs.",
      "I'd like to document the process, ask focused questions, and learn how other people finish ideas.",
    ],
    recommendationBasis: [
      "Shows intent, self-awareness, and a clear use for the community.",
      "Meaningful participation and creative development matter more than polish or existing status.",
    ],
    neutralMissingInformation: [
      "Released work",
      "Professional credits",
      "Established audience",
    ],
  },
] as const satisfies readonly ColorsReviewerCalibrationCase[]
