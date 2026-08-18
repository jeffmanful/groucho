import { describe, expect, it } from "vitest"
import {
  collectApplicationBridgeHistory,
  normaliseApplicationBridgePlan,
  validateApplicationBridgeSelection,
} from "@/lib/application-conversation-bridge"

const artistBridge = {
  sourceDetail: "They named Tirzah",
  kind: "person_to_work",
  targetSignalKey: "recommendation",
  questionIntent: "Ask which Tirzah song they would share and why",
  confidence: 0.91,
  freshness: "current",
}

describe("application conversation bridge", () => {
  it("normalises at most three auditable bridge candidates", () => {
    const plan = normaliseApplicationBridgePlan({
      candidates: [artistBridge, artistBridge, artistBridge, artistBridge],
      selectedIndex: 0,
    })
    expect(plan.candidates).toHaveLength(3)
    expect(plan.selected).toMatchObject({ kind: "person_to_work" })
  })

  it("does not shift a selected index when an earlier candidate is malformed", () => {
    const plan = normaliseApplicationBridgePlan({
      candidates: [{ kind: "invalid" }, artistBridge],
      selectedIndex: 1,
    })
    expect(plan.candidates).toHaveLength(1)
    expect(plan.selectedIndex).toBe(0)
    expect(plan.selected).toMatchObject({ kind: "person_to_work" })
  })

  it("accepts a confident bridge into an eligible evidence goal", () => {
    const plan = normaliseApplicationBridgePlan({
      candidates: [artistBridge],
      selectedIndex: 0,
    })
    expect(
      validateApplicationBridgeSelection({
        plan,
        history: { recentKinds: [], lastKind: null, repeatedKindCount: 0 },
        eligibleSignalKeys: new Set(["recommendation"]),
        remainingQuestions: 6,
        isTerminal: false,
      }),
    ).toEqual(plan.selected)
  })

  it("rejects low-confidence, closed-goal, terminal, and repeated bridges", () => {
    const plan = normaliseApplicationBridgePlan({
      candidates: [artistBridge],
      selectedIndex: 0,
    })
    expect(
      validateApplicationBridgeSelection({
        plan,
        history: {
          recentKinds: ["person_to_work", "person_to_work"],
          lastKind: "person_to_work",
          repeatedKindCount: 2,
        },
        eligibleSignalKeys: new Set(["recommendation"]),
        remainingQuestions: 6,
        isTerminal: false,
      }),
    ).toBeNull()
    expect(
      validateApplicationBridgeSelection({
        plan,
        history: { recentKinds: [], lastKind: null, repeatedKindCount: 0 },
        eligibleSignalKeys: new Set(),
        remainingQuestions: 6,
        isTerminal: false,
      }),
    ).toBeNull()
    expect(
      validateApplicationBridgeSelection({
        plan,
        history: { recentKinds: [], lastKind: null, repeatedKindCount: 0 },
        eligibleSignalKeys: new Set(["recommendation"]),
        remainingQuestions: 0,
        isTerminal: true,
      }),
    ).toBeNull()
  })

  it("collects recent bridge kinds for repetition control", () => {
    expect(
      collectApplicationBridgeHistory([
        {
          role: "assistant",
          metadata: { conversation_bridge: artistBridge },
        },
        { role: "user" },
        {
          role: "assistant",
          metadata: { conversation_bridge: artistBridge },
        },
      ]),
    ).toEqual({
      recentKinds: ["person_to_work", "person_to_work"],
      lastKind: "person_to_work",
      repeatedKindCount: 2,
    })
  })

  it("prefers a fresh core maker disclosure over a supporting artist bridge", () => {
    const makerBridge = {
      sourceDetail: "They make music influenced by the artist",
      kind: "maker_to_practice",
      targetSignalKey: "contribution",
      questionIntent: "Ask what they are trying to express in their own work",
      confidence: 0.88,
      freshness: "current",
    }
    const plan = normaliseApplicationBridgePlan({
      candidates: [artistBridge, makerBridge],
      selectedIndex: 0,
    })
    expect(
      validateApplicationBridgeSelection({
        plan,
        history: { recentKinds: [], lastKind: null, repeatedKindCount: 0 },
        eligibleSignalKeys: new Set(["recommendation", "contribution"]),
        remainingQuestions: 5,
        isTerminal: false,
        signalPriorities: new Map([
          ["recommendation", "supporting"],
          ["contribution", "core"],
        ]),
      }),
    ).toMatchObject({ kind: "maker_to_practice", targetSignalKey: "contribution" })
  })
})
