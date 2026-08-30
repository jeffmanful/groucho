import { describe, expect, it } from "vitest"
import {
  collectApplicationParticipantOrientation,
  inferApplicationParticipantOrientation,
  mergeApplicationParticipantOrientation,
  normaliseApplicationParticipantOrientation,
} from "@/lib/application-participant-orientation"

describe("application participant orientation", () => {
  it("recognises naturally qualified maker and discovery language", () => {
    expect(
      inferApplicationParticipantOrientation({
        currentAnswer: "I'm a South London producer making sparse electronic R&B.",
      }).primary,
    ).toBe("artist")
    expect(
      inferApplicationParticipantOrientation({
        currentAnswer: "I've only been making music seriously for eight months.",
      }).primary,
    ).toBe("artist")
    expect(
      inferApplicationParticipantOrientation({
        currentAnswer: "I spend a lot of time finding new music through local radio.",
      }).primary,
    ).toBe("enthusiast")
    expect(
      inferApplicationParticipantOrientation({
        currentAnswer: "I have started making my own music to upload too.",
      }).primary,
    ).toBe("artist")
  })

  it("keeps future participation out of current-practice orientation", () => {
    const emergingCurator = inferApplicationParticipantOrientation({
      currentAnswer:
        "I mostly listen now, but I would like to start organising a listening night.",
    })
    const emergingArtist = inferApplicationParticipantOrientation({
      currentAnswer: "I curate releases now and want to start making my own music.",
    })

    expect(emergingCurator.scores.curator).toBe(0)
    expect(emergingCurator.primary).toBe("enthusiast")
    expect(emergingArtist.scores.artist).toBe(0)
    expect(emergingArtist.primary).toBe("curator")
  })

  it("does not infer curation from admiration or a desire for collaborators", () => {
    expect(
      inferApplicationParticipantOrientation({
        currentAnswer: "I admire the strength of their curation and art direction.",
      }).scores.curator,
    ).toBe(0)
    expect(
      inferApplicationParticipantOrientation({
        currentAnswer: "I want to connect with other artists.",
      }).scores.curator,
    ).toBe(0)
    const merged = mergeApplicationParticipantOrientation({
      previous: {
        primary: "unknown",
        scores: { artist: 0, curator: 0, enthusiast: 0 },
        confidence: 0,
        evidence: [],
      },
      proposed: normaliseApplicationParticipantOrientation({
        scores: { artist: 0.1, curator: 0.9, enthusiast: 0 },
        evidence: ["Mentions curation"],
      }),
      currentAnswer: "I admire the strength of their curation and art direction.",
    })
    expect(merged.scores.curator).toBe(0)
  })

  it("does not treat an explicit non-artist statement as artist evidence", () => {
    const orientation = inferApplicationParticipantOrientation({
      currentAnswer: "I'm not an artist; I spend my time finding new music.",
    })

    expect(orientation.primary).toBe("enthusiast")
    expect(orientation.scores.artist).toBe(0)
  })

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

  it("does not classify someone as a maker merely because they discuss artists", () => {
    const orientation = inferApplicationParticipantOrientation({
      currentAnswer:
        "I host a listening group and share context for each artist we feature.",
    })
    expect(orientation.primary).toBe("curator")
    expect(orientation.scores.artist).toBe(0)
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
