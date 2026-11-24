import { describe, expect, it } from "vitest"
import { agreement, checkRun, scenarioConsistency, twinAgreement } from "@/evals/pilot/checks"
import type { PilotFlow, PilotRun, PilotTurn, Scenario } from "@/evals/pilot/types"
import type { SignalEvidenceStatus } from "@/lib/project-conversation-evidence"

const signal = (id: string, name: string) => ({ id, name, understanding: "u", evidence: "", examples: [], explore: true, question: "", answerType: "auto" as const, options: [] })
const flow: PilotFlow = {
  slug: "test", name: "Test", organisationId: "org", projectId: "project", pulledAt: "now",
  config: { version: 2, openingMessage: "Hello.", openingQuestion: "What brings you here?", maxAnswers: 3, intent: "Understand.", replyStyle: "direct",
    persona: { name: "Host", instructions: "Be brief." }, closingMessage: "Thanks for your time.", signals: [signal("a", "Practice"), signal("b", "Basics")] },
}
const evidence = (a: SignalEvidenceStatus, b: SignalEvidenceStatus, quote = "I write songs") => ({
  a: { status: a, summary: "", reason: "", sources: a === "not_explored" ? [] : [{ quote, turn: 1 }] },
  b: { status: b, summary: "", reason: "", sources: [] },
})
const turn = (answerNumber: number, answer: string, reply: string, extra: Partial<PilotTurn> = {}): PilotTurn => ({
  answerNumber, answer, answerSource: "test", reply, status: "active", latencyMs: 1, calls: [], retries: 0, ...extra,
})
const run = (turns: PilotTurn[], ended: PilotRun["ended"] = "completed"): PilotRun => ({ flow: "test", scenario: "s", repeat: 1, opening: "Hello.", turns, ended })
const scenario: Scenario = { id: "s", description: "", opening: "I write songs at home.", answers: {}, fallback: [] }
const failed = (target: PilotRun, with_: Scenario = scenario) => checkRun(flow, with_, target).filter(check => !check.pass).map(check => check.check)

describe("pilot harness checks", () => {
  it("passes a clean conversation", () => {
    expect(failed(run([
      turn(1, "I write songs at home.", "Where are you based?", { signalTurn: { questionSignalId: "b", followUp: false, changes: [] }, signalEvidence: evidence("evidence_found", "not_explored") }),
      turn(2, "Leeds.", "Thanks for your time.", { status: "completed", signalEvidence: evidence("evidence_found", "evidence_found") }),
    ]))).toEqual([])
  })

  it("flags broken rules", () => {
    const broken = run([
      turn(1, "I write songs at home.", "What do you write? And where?", { signalTurn: { questionSignalId: "a", followUp: false, changes: [] }, signalEvidence: evidence("evidence_found", "not_explored") }),
      turn(2, "Please stop.", "Where are you based?", { signalTurn: { questionSignalId: "b", followUp: false, changes: [] }, signalEvidence: evidence("evidence_found", "not_explored") }),
      turn(3, "Leeds.", "Where are you based?", { signalEvidence: evidence("evidence_found", "not_explored", "a quote never said") }),
      turn(4, "Leeds.", "Good luck! Anything else?", { status: "completed", signalEvidence: evidence("evidence_found", "not_explored", "a quote never said") }),
    ])
    expect(failed(broken, { ...scenario, events: [{ atAnswer: 2, kind: "stop", say: "Please stop." }], expect: { signals: { Basics: ["evidence_found"] } } })).toEqual([
      "answer_ceiling", "final_message", "closing_has_no_question", "stop_respected", "quotes_grounded",
      "no_question_on_settled_signal", "no_repeated_question", "one_question_per_reply", "expected_signals",
    ])
  })

  it("measures agreement between repeats and between twins", () => {
    expect(agreement(["x", "x", "y"])).toBeCloseTo(2 / 3)
    const ending = (a: SignalEvidenceStatus, target: string) => run([
      turn(1, "I write songs at home.", "Next?", { signalTurn: { questionSignalId: target, followUp: false, changes: [] }, signalEvidence: evidence(a, "not_explored") }),
      turn(2, "Leeds.", "Thanks for your time.", { status: "completed", signalEvidence: evidence(a, "not_explored") }),
    ])
    const runs = [ending("evidence_found", "b"), ending("evidence_found", "b"), ending("partly_understood", "a")]
    const result = scenarioConsistency(flow, scenario, runs)
    expect(result.signals.Practice.agreement).toBeCloseTo(2 / 3)
    expect(result.signals.Basics.agreement).toBe(1)
    expect(result.pathAgreement).toBeCloseTo(2 / 3)
    expect(result.answers).toEqual({ min: 2, max: 2 })
    expect(twinAgreement(flow, runs, [ending("partly_understood", "b")])).toBe(0.5)
  })
})
