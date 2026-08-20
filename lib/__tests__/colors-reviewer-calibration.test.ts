import { describe, expect, it } from "vitest"
import { COLORS_RECOMMEND_CALIBRATION_CASES } from "@/evals/colors-reviewer-calibration"
import {
  EMPTY_APPLICATION_PARTICIPANT_ORIENTATION,
  inferApplicationParticipantOrientation,
} from "@/lib/application-participant-orientation"
import { buildApplicationExperiencePromptAppendix } from "@/lib/application-experience-prompt"

function orientationFor(evidence: readonly string[]) {
  return evidence.reduce(
    (previous, currentAnswer) =>
      inferApplicationParticipantOrientation({ previous, currentAnswer }),
    EMPTY_APPLICATION_PARTICIPANT_ORIENTATION,
  )
}

describe("COLORS reviewer recommend calibration", () => {
  it("contains the five client-confirmed positive anchors", () => {
    expect(COLORS_RECOMMEND_CALIBRATION_CASES).toHaveLength(5)
    expect(new Set(COLORS_RECOMMEND_CALIBRATION_CASES.map(({ id }) => id)).size).toBe(5)
    expect(
      COLORS_RECOMMEND_CALIBRATION_CASES.every(
        ({ expectedRecommendation }) => expectedRecommendation === "recommend",
      ),
    ).toBe(true)
  })

  it.each(COLORS_RECOMMEND_CALIBRATION_CASES)(
    "recognises the participation route for $name",
    ({ applicantEvidence, expectedOrientation }) => {
      expect(orientationFor(applicantEvidence).primary).toBe(expectedOrientation)
    },
  )

  it.each(COLORS_RECOMMEND_CALIBRATION_CASES)(
    "keeps omissions explicitly neutral for $name",
    ({ recommendationBasis, neutralMissingInformation }) => {
      expect(recommendationBasis.length).toBeGreaterThan(0)
      expect(neutralMissingInformation.length).toBeGreaterThan(0)
      expect(
        recommendationBasis.some((reason) =>
          neutralMissingInformation.some((missing) =>
            reason.toLowerCase().includes(missing.toLowerCase()),
          ),
        ),
      ).toBe(false)
    },
  )

  it("keeps credentials and audience signals out of the COLORS scoring rubric", () => {
    const appendix = buildApplicationExperiencePromptAppendix({
      opening_message: "Why do you want to be an early applicant for the Forum?",
      required_signals: [
        "What brought you here?",
        "Name an artist more people should know about.",
        "Someone shares unfinished music that isn't really for you. How would you respond?",
        "What's one thing you could realistically contribute in your first month?",
      ],
    })

    expect(appendix).toContain("small audience size")
    expect(appendix).toContain("lack of follower count")
    expect(appendix).toContain("lack of fame")
    expect(appendix).toContain("lack of industry connections")
    expect(appendix).toContain("Formal scene status is never required")
  })
})
