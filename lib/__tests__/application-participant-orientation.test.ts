import { describe, expect, it } from "vitest"
import {
  collectApplicationParticipantOrientation,
  inferApplicationParticipantOrientation,
  mergeApplicationParticipantOrientation,
  normaliseApplicationParticipantOrientation,
} from "@/lib/application-participant-orientation"

describe("application participant orientation", () => {
  it("normalises artist, curator, enthusiast, and hybrid hypotheses", () => {
    expect(
      normaliseApplicationParticipantOrientation({
        scores: { artist: 0.9, curator: 0.1, enthusiast: 0.2 },
        evidence: ["Makes music"],
      }).primary,
    ).toBe("artist")
    expect(
      normaliseApplicationParticipantOrientation({
        scores: { artist: 0.78, curator: 0.72, enthusiast: 0.1 },
        evidence: ["Makes music", "Runs a listening night"],
      }).primary,
    ).toBe("hybrid")
  })

  it("recognises explicit listener and maker disclosures without status inference", () => {
    const listener = inferApplicationParticipantOrientation({
      currentAnswer: "I mostly listen and come to discover new music.",
    })
    expect(listener).toMatchObject({ primary: "enthusiast", confidence: 0.82 })

    const hybrid = mergeApplicationParticipantOrientation({
      previous: listener,
      proposed: normaliseApplicationParticipantOrientation({
        scores: { artist: 0.86, curator: 0, enthusiast: 0.8 },
        evidence: ["They also make their own music"],
      }),
      currentAnswer: "I make my own music too.",
    })
    expect(hybrid.primary).toBe("hybrid")
  })

  it("treats an explicit community opening as an enthusiast route", () => {
    expect(
      inferApplicationParticipantOrientation({ currentAnswer: "Community" }),
    ).toMatchObject({
      primary: "enthusiast",
      confidence: 0.72,
      evidence: ["Names community as their reason for being here"],
    })
    expect(
      inferApplicationParticipantOrientation({
        currentAnswer: "I'm here for the community.",
      }).primary,
    ).toBe("enthusiast")
  })

  it("does not turn a strongly evidenced curator into a hybrid from taste alone", () => {
    const previous = normaliseApplicationParticipantOrientation({
      scores: { artist: 0.08, curator: 0.88, enthusiast: 0.12 },
      evidence: ["Runs a listening night"],
    })
    const merged = mergeApplicationParticipantOrientation({
      previous,
      proposed: normaliseApplicationParticipantOrientation({
        scores: { artist: 0.08, curator: 0.88, enthusiast: 0.82 },
        evidence: ["Shows thoughtful taste"],
      }),
      currentAnswer: "I love how carefully that record leaves space.",
    })
    expect(merged.primary).toBe("curator")
    expect(merged.scores.enthusiast).toBe(0.12)
  })

  it("collects the most recent persisted orientation", () => {
    const latest = collectApplicationParticipantOrientation([
      {
        role: "assistant",
        metadata: {
          participant_orientation: {
            scores: { artist: 0.1, curator: 0.1, enthusiast: 0.8 },
            evidence: ["Mostly listens"],
          },
        },
      },
    ])
    expect(latest.primary).toBe("enthusiast")
  })
})
