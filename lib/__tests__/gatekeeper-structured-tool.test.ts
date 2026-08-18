import { describe, expect, it } from "vitest"
import {
  GATEKEEPER_RESPONSE_TOOL_NAME,
  parseGatekeeperStructuredResponse,
} from "@/lib/gatekeeper-structured-tool"

function toolBlock(input: Record<string, unknown>) {
  return {
    type: "tool_use" as const,
    id: "toolu_test",
    name: GATEKEEPER_RESPONSE_TOOL_NAME,
    input,
  }
}

describe("parseGatekeeperStructuredResponse", () => {
  it("reads reply, terminal, and interaction spec from groucho_respond", () => {
    const content = [
      toolBlock({
        reply: "Tell me more.",
        terminal: "none",
        intent: "probe",
        inputType: "text",
        emotionalState: "curious",
        visualState: "curious",
        scores: {
          specificity: 0.7,
          authenticity: 0.8,
          cultural_depth: 0.6,
          overall: 0.7,
        },
        answerAssessment: {
          quality: "rich",
          reason: "Offers a particular observation about how attention works.",
          evidence: {
            personalPointOfView: true,
            concreteDetail: true,
            emotionalConnection: false,
            independentJudgment: true,
            careOrContext: true,
          },
        },
        conversationMove: "rabbit_hole",
        responseMode: "deepen",
        culturalSignals: [
          { type: "artist_reference", displayLabel: "Kelela", confidence: 0.92 },
        ],
        coveredSignalKeys: ["cultural_point_of_view", "discovery_and_sharing"],
        bridgeCandidates: [
          {
            sourceDetail: "Space between releases protects the work",
            kind: "tension_to_judgment",
            targetSignalKey: "community_contribution",
            questionIntent:
              "Connect their care for artistic restraint to how they would participate",
            confidence: 0.82,
            freshness: "current",
          },
        ],
        selectedBridgeIndex: 0,
        threadState: {
          subject: "Artistic restraint",
          strongestDetail: "Space between releases protects the work",
          openHook: "Whether visibility would change it",
          momentum: "high",
          applicantEnergy: "thoughtful",
          acknowledgedDetails: ["Space between releases"],
        },
        nextSignalKey: "community_contribution",
      }),
    ]
    const out = parseGatekeeperStructuredResponse(content as never)
    expect(out.toolSeen).toBe(true)
    expect(out.terminal).toBe("none")
    expect(out.reply).toBe("Tell me more.")
    expect(out.interaction).toEqual({
      intent: "probe",
      inputType: "text",
      emotionalState: "curious",
      visualState: "curious",
    })
    expect(out.scores).toEqual({
      specificity: 0.7,
      authenticity: 0.8,
      cultural_depth: 0.6,
      overall: 0.7,
    })
    expect(out.nextSignalKey).toBe("community_contribution")
    expect(out.answerAssessment?.quality).toBe("rich")
    expect(out.conversationMove).toBe("rabbit_hole")
    expect(out.responseMode).toBe("deepen")
    expect(out.coveredSignalKeys).toEqual([
      "cultural_point_of_view",
      "discovery_and_sharing",
    ])
    expect(out.bridgePlan.selected).toMatchObject({
      kind: "tension_to_judgment",
      targetSignalKey: "community_contribution",
      confidence: 0.82,
    })
    expect(out.threadState).toMatchObject({
      subject: "Artistic restraint",
      momentum: "high",
      applicantEnergy: "thoughtful",
    })
    expect(out.culturalSignals).toEqual([
      {
        type: "artist_reference",
        normalizedKey: "kelela",
        displayLabel: "Kelela",
        confidence: 0.92,
        isSensitive: false,
      },
    ])
  })

  it("defaults terminal to none when tool input is invalid", () => {
    const content = [
      toolBlock({
        reply: "Hi",
        terminal: "maybe",
        intent: "probe",
        inputType: "text",
        emotionalState: "neutral",
        visualState: "thinking",
      }),
    ]
    const out = parseGatekeeperStructuredResponse(content as never)
    expect(out.toolSeen).toBe(true)
    expect(out.terminal).toBe("none")
  })

  it("falls back to defaults when tool is absent", () => {
    const content = [
      { type: "text" as const, text: "Plain\n" },
      { type: "text" as const, text: "reply" },
    ]
    const out = parseGatekeeperStructuredResponse(content as never)
    expect(out.toolSeen).toBe(false)
    expect(out.terminal).toBe(null)
    expect(out.reply).toBe("Plain\n\nreply")
    expect(out.interaction.inputType).toBe("text")
    expect(out.scores).toEqual({
      specificity: 0.5,
      authenticity: 0.5,
      cultural_depth: 0.5,
      overall: 0.5,
    })
    expect(out.nextSignalKey).toBeNull()
    expect(out.answerAssessment).toBeNull()
    expect(out.conversationMove).toBeNull()
  })

  it("ignores malformed depth assessments and moves", () => {
    const content = [
      toolBlock({
        reply: "Tell me more.",
        terminal: "none",
        intent: "probe",
        inputType: "text",
        emotionalState: "curious",
        visualState: "curious",
        answerAssessment: {
          quality: "long",
          evidence: {},
        },
        conversationMove: "interrogate",
      }),
    ]
    const out = parseGatekeeperStructuredResponse(content as never)
    expect(out.answerAssessment).toBeNull()
    expect(out.conversationMove).toBeNull()
  })

  it("bounds and rejects malformed bridge plans", () => {
    const content = [
      toolBlock({
        reply: "Tell me more.",
        terminal: "none",
        bridgeCandidates: [
          {
            sourceDetail: "An invented route",
            kind: "interrogate",
            targetSignalKey: "../../bad",
            questionIntent: "Keep digging",
            confidence: 3,
            freshness: "forever",
          },
        ],
        selectedBridgeIndex: 0,
      }),
    ]
    const out = parseGatekeeperStructuredResponse(content as never)
    expect(out.bridgePlan).toEqual({
      candidates: [],
      selectedIndex: -1,
      selected: null,
    })
  })

  it("uses neutral scores when the structured assessment is malformed", () => {
    const content = [
      toolBlock({
        reply: "Tell me more.",
        terminal: "none",
        intent: "probe",
        inputType: "text",
        emotionalState: "curious",
        visualState: "curious",
        scores: { specificity: "high" },
      }),
    ]
    const out = parseGatekeeperStructuredResponse(content as never)
    expect(out.scores.overall).toBe(0.5)
  })

  it("normalises reviewer reports on terminal turns", () => {
    const content = [
      toolBlock({
        reply: "Thanks. We'll be in touch.",
        terminal: "pass",
        intent: "decide",
        inputType: "text",
        emotionalState: "decisive",
        visualState: "decision",
        scores: {
          specificity: 0.9,
          authenticity: 0.8,
          cultural_depth: 0.85,
          overall: 0.88,
        },
        reviewerReport: {
          applicant_bio:
            "Runs a small listening night and writes context notes for each artist.",
          advisory_recommendation: "recommend",
          confidence_score: 1.2,
          evidence_summary: [
            "Monthly listening night",
            "Specific role selecting artists",
          ],
          weak_or_missing_signals: [],
          safety_or_integrity_flags: [],
          reviewer_focus: "Confirm whether the proposed Forum thread is useful.",
        },
      }),
    ]

    const out = parseGatekeeperStructuredResponse(content as never)

    expect(out.reviewerReport).toEqual({
      applicant_bio:
        "Runs a small listening night and writes context notes for each artist.",
      advisory_recommendation: "recommend",
      confidence_score: 1,
      evidence_summary: [
        "Monthly listening night",
        "Specific role selecting artists",
      ],
      weak_or_missing_signals: [],
      safety_or_integrity_flags: [],
      reviewer_focus: "Confirm whether the proposed Forum thread is useful.",
    })
  })

  it("ignores reviewer reports on active turns", () => {
    const content = [
      toolBlock({
        reply: "Tell me more.",
        terminal: "none",
        intent: "probe",
        inputType: "text",
        emotionalState: "curious",
        visualState: "curious",
        scores: {
          specificity: 0.7,
          authenticity: 0.8,
          cultural_depth: 0.6,
          overall: 0.7,
        },
        reviewerReport: {
          applicant_bio: "Should not be used yet.",
          advisory_recommendation: "recommend",
          confidence_score: 0.9,
          evidence_summary: [],
          weak_or_missing_signals: [],
          safety_or_integrity_flags: [],
          reviewer_focus: "None.",
        },
      }),
    ]

    const out = parseGatekeeperStructuredResponse(content as never)
    expect(out.reviewerReport).toBeNull()
  })
})
