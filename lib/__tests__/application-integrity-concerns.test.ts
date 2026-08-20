import { describe, expect, it } from "vitest"
import {
  applicationIntegrityChallengeQuestion,
  assessmentWithIntegrityConcerns,
  calibratedStatusForIntegrityHistory,
  collectApplicationIntegrityConcerns,
  detectApplicationIntegrityConcerns,
} from "@/lib/application-integrity-concerns"

describe("application integrity concerns", () => {
  it.each([
    {
      answer:
        "I said I run a group, but that was not true. I thought it would improve my chances.",
      kind: "admitted_fabrication",
    },
    {
      answer:
        "If an artist sends me a private demo, I post it without asking because exposure helps.",
      kind: "artist_consent_violation",
    },
    {
      answer:
        "I want direct access to emerging artists so I can grow my platform.",
      kind: "extractive_access_intent",
    },
  ])("detects $kind from explicit evidence", ({ answer, kind }) => {
    expect(detectApplicationIntegrityConcerns(answer)).toEqual([
      expect.objectContaining({ kind }),
    ])
  })

  it.each([
    "I want to help an artist grow their audience with their permission.",
    "I host a listening group and ask before sharing unfinished work.",
    "I would like early access so I can prepare a thoughtful interview with the artist.",
  ])("does not flag adjacent but non-concerning language: %s", (answer) => {
    expect(detectApplicationIntegrityConcerns(answer)).toEqual([])
  })

  it("forces a concerning assessment and a consent-specific challenge", () => {
    const concerns = detectApplicationIntegrityConcerns(
      "I post private demos without asking.",
    )
    expect(assessmentWithIntegrityConcerns(null, concerns)).toMatchObject({
      quality: "concerning",
    })
    expect(applicationIntegrityChallengeQuestion(concerns)).toContain(
      "their permission matters",
    )
  })

  it("collects persisted concerns once per kind", () => {
    const concerns = detectApplicationIntegrityConcerns(
      "I said it was true, but it was not true.",
    )
    expect(
      collectApplicationIntegrityConcerns([
        {
          role: "user",
          metadata: { application_integrity_concerns: concerns },
        },
        {
          role: "user",
          metadata: { application_integrity_concerns: concerns },
        },
      ]),
    ).toHaveLength(1)
  })

  it.each([
    ["admitted_fabrication", "redirected"],
    ["extractive_access_intent", "redirected"],
    ["artist_consent_violation", "rejected"],
  ] as const)(
    "maps repeated %s to the calibrated %s outcome",
    (kind, expected) => {
      const concern = {
        kind,
        reason: "Reason",
        reviewerFlag: "Flag",
      }
      expect(
        calibratedStatusForIntegrityHistory({
          stored: [concern],
          current: [concern],
          terminalProposed: false,
        }),
      ).toBe(expected)
      expect(
        calibratedStatusForIntegrityHistory({
          stored: [],
          current: [concern],
          terminalProposed: false,
        }),
      ).toBeNull()
    },
  )

  it("keeps admitted fabrication in human review when a later turn proposes a terminal outcome", () => {
    expect(
      calibratedStatusForIntegrityHistory({
        stored: [{
          kind: "admitted_fabrication",
          reason: "Reason",
          reviewerFlag: "Flag",
        }],
        current: [],
        terminalProposed: true,
      }),
    ).toBe("redirected")
  })
})
