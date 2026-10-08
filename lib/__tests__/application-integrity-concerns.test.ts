import { describe, expect, it } from "vitest"
import {
  applicationIntegrityChallengeQuestion,
  assessmentWithIntegrityConcerns,
  calibratedStatusForIntegrityHistory,
  collectApplicationIntegrityConcerns,
  detectApplicationIntegrityConcerns,
  sourceLinkedApplicationIntegrityConcern,
  sourceLinkedConsentResolution,
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
    "A COLORS performance is a shared reference that everyone can access without asking an artist to expose vulnerable work first.",
    "I would not share private or unreleased artist work without permission.",
    "I only share unfinished tracks with the artist's permission.",
  ])("does not flag adjacent but non-concerning language: %s", (answer) => {
    expect(detectApplicationIntegrityConcerns(answer)).toEqual([])
  })

  it("describes promotional intent without inventing privileged artist access", () => {
    const concerns = detectApplicationIntegrityConcerns(
      "I want early access because it could grow my audience.",
    )
    expect(concerns[0]?.reviewerFlag).not.toContain("privileged artist access")
  })

  it("forces a concerning assessment and a consent-specific challenge", () => {
    const concerns = detectApplicationIntegrityConcerns(
      "I post private demos without asking.",
    )
    expect(assessmentWithIntegrityConcerns(null, concerns)).toMatchObject({
      quality: "concerning",
    })
    expect(applicationIntegrityChallengeQuestion(concerns)).toContain(
      "permission matters",
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

  it("carries a semantic consent disclosure only with an exact applicant quote", () => {
    const answer = "I put up unreleased clips and don't always ask first."
    expect(detectApplicationIntegrityConcerns(answer)).toEqual([])
    const observation = sourceLinkedApplicationIntegrityConcern(
      { kind: "artist_consent_violation", quote: "don't always ask first" },
      answer,
      "m-consent",
    )
    expect(observation).toMatchObject({
      kind: "artist_consent_violation",
      quote: "don't always ask first",
      sourceMessageId: "m-consent",
    })
    expect(sourceLinkedApplicationIntegrityConcern(
      { kind: "artist_consent_violation", quote: "I never ask" },
      answer,
      "m-consent",
    )).toBeNull()
    expect(collectApplicationIntegrityConcerns([{
      id: "m-consent",
      role: "user",
      content: answer,
      metadata: { application_integrity_concerns: [observation] },
    }])).toMatchObject([observation])
  })

  it("keeps an unconfirmed permission question distinct from a violation, then clears it on sourced confirmation", () => {
    const answer = "I would share an unreleased demo she sent me."
    const pending = sourceLinkedApplicationIntegrityConcern(
      { kind: "artist_consent_unestablished", quote: "unreleased demo she sent me" },
      answer,
      "m-pending",
    )
    expect(pending?.reviewerFlag).toBe("")
    expect(applicationIntegrityChallengeQuestion(pending ? [pending] : [])).toContain("has the artist said")
    const confirmation = sourceLinkedConsentResolution(
      { kind: "artist_consent_confirmed", quote: "She told me I can share it" },
      "She told me I can share it publicly.",
      "m-confirmed",
    )
    expect(collectApplicationIntegrityConcerns([
      { id: "m-pending", role: "user", content: answer, metadata: { application_integrity_concerns: [pending] } },
      { id: "m-confirmed", role: "user", content: "She told me I can share it publicly.", metadata: { application_integrity_resolution: confirmation } },
    ])).toEqual([])
    expect(sourceLinkedApplicationIntegrityConcern(
      { kind: "artist_consent_unestablished", quote: "without permission" },
      "I would post it without permission.",
      "m-refusal",
    )?.kind).toBe("artist_consent_violation")
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
