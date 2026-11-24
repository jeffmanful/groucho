import { describe, expect, it } from "vitest"
import { conversationPhase, emptyWorkingMemory, groundedQuote, openConversationState, readWorkingMemory, recordAnswer, recordQuestion, shouldShowAreas, threadPlan, workingMemoryForPrompt } from "@/lib/project-conversation-memory"
import { projectSignalProgress } from "@/lib/project-conversation-progress"
import { emptySignalEvidence } from "@/lib/project-conversation-evidence"

const signal = (id: string, name: string) => ({ id, name, understanding: "u", evidence: "", examples: [], explore: true, question: "", answerType: "auto" as const, options: [] })
const signals = [signal("s_music", "Music"), signal("s_make", "Making")]
const opening = "I've had the new record on all week, and I've been cutting a short film."

describe("project conversation working memory", () => {
  it("keeps threads only when quoted from the current answer, and links them to known signals", () => {
    const memory = recordAnswer(emptyWorkingMemory(), { relation: "answered", answer: opening, turn: 1, signals, threads: [
      { detail: "Listening to a new record", quote: "I've had the new record on all week", relatedSignalIds: ["s_music", "s_unknown"] },
      { detail: "Invented", quote: "I run a label", relatedSignalIds: [] },
    ] })
    expect(memory.threads).toEqual([{ id: "t1", detail: "Listening to a new record", quote: "I've had the new record on all week", turn: 1, signalIds: ["s_music"] }])
    expect(memory.relations).toEqual([{ turn: 1, relation: "answered" }])
    // The same words are not stored twice.
    expect(recordAnswer(memory, { relation: "answered", answer: opening, turn: 2, signals, threads: [{ detail: "Again", quote: "the new record", relatedSignalIds: [] }] }).threads).toHaveLength(1)
  })

  it("records a connected question, marks its thread followed and stores how it was answered", () => {
    let memory = recordAnswer(emptyWorkingMemory(), { relation: "answered", answer: opening, turn: 1, signals, threads: [{ detail: "Record", quote: "I've had the new record on all week", relatedSignalIds: ["s_music"] }] })
    const buildsOn = groundedQuote("the new record", [opening])
    expect(buildsOn).toBe("the new record")
    expect(groundedQuote("their radio show", [opening])).toBeUndefined()
    memory = recordQuestion(memory, { signalId: "s_music", question: "Who did you last play it to?", buildsOn, turn: 1 })
    expect(memory.threads[0].followedAt).toBe(1)
    memory = recordAnswer(memory, { relation: "passed_over", answer: "I ran the door at a fundraiser.", turn: 2, signals, threads: [] })
    expect(memory.attempts).toEqual([{ signalId: "s_music", turn: 1, question: "Who did you last play it to?", buildsOn: "the new record", outcome: "passed_over" }])
    expect(workingMemoryForPrompt(memory, signals)).toEqual({ openThreads: [], questionsAsked: [{ signalId: "s_music", signal: "Music", question: "Who did you last play it to?", connected: true, outcome: "passed_over" }] })
    expect(readWorkingMemory(JSON.parse(JSON.stringify(memory)))).toEqual(memory)
    expect(readWorkingMemory("nonsense")).toEqual(emptyWorkingMemory())
  })

  it("moves from opening to middle to landing as answers run out", () => {
    expect(conversationPhase(1, 8, 5)).toBe("opening")
    expect(conversationPhase(2, 8, 2)).toBe("middle")
    expect(conversationPhase(6, 8, 1)).toBe("landing")
    expect(conversationPhase(4, 8, 4)).toBe("landing")
    expect(conversationPhase(5, undefined, 3)).toBe("middle")
  })

  it("treats a signal as fairly attempted after two questions", () => {
    const progress = (asked: number) => projectSignalProgress(signals, emptySignalEvidence(signals), new Map([["s_music", { asked, followUps: Math.max(0, asked - 1) }]]))[0].canAsk
    expect(progress(1)).toBe(true)
    expect(progress(2)).toBe(false)
  })
})

import { conversationSelfCheck, type WorkingMemory } from "@/lib/project-conversation-memory"

describe("conversation self-check", () => {
  const progress = [
    { id: "s_music", name: "Music", canAsk: true, asked: 1 },
    { id: "s_make", name: "Making", canAsk: true, asked: 0 },
    { id: "s_basics", name: "Basics", canAsk: true, asked: 0 },
  ]
  const memory = (attempts: WorkingMemory["attempts"], relations: WorkingMemory["relations"] = []): WorkingMemory => ({ threads: [], attempts, relations })
  const check = (input: Partial<Parameters<typeof conversationSelfCheck>[0]>) => conversationSelfCheck({ memory: memory([]), progress, turnCount: 3, maxAnswers: 12, quietTurns: 0, ...input })

  it("says nothing when the conversation is going well", () => {
    expect(check({ memory: memory([{ signalId: "s_music", turn: 1, question: "Q?", buildsOn: "the record", outcome: "answered" }], [{ turn: 2, relation: "answered" }]) })).toBeUndefined()
  })

  it("notices a passed-over question, and two in a row", () => {
    const once = check({ memory: memory([{ signalId: "s_music", turn: 2, question: "Q?", outcome: "passed_over" }], [{ turn: 3, relation: "passed_over" }]) })
    expect(once).toMatchObject({ kind: "passed_over", allowBridge: true })
    expect(once?.note).toContain("about Music")
    expect(check({ memory: memory([], [{ turn: 2, relation: "passed_over" }, { turn: 3, relation: "passed_over" }]) })?.note).toContain("two questions in a row")
  })

  it("reins in when the remaining answers barely cover the untried areas", () => {
    expect(check({ turnCount: 5, maxAnswers: 8 })).toMatchObject({ kind: "rein_in", allowBridge: true })
    expect(check({ turnCount: 5, maxAnswers: 8 })?.note).toContain("Making, Basics")
    expect(check({ turnCount: 3, maxAnswers: 8 })).toBeUndefined()
  })

  it("pivots after two engaged questions on one area and stops after two fruitless ones", () => {
    const twice = (outcome: "answered" | "nothing_to_share") => memory([
      { signalId: "s_music", turn: 1, question: "Q1?", outcome: "answered" }, { signalId: "s_music", turn: 2, question: "Q2?", outcome }])
    expect(check({ memory: twice("answered") })).toMatchObject({ kind: "pivot", allowBridge: true })
    expect(check({ memory: twice("answered") })?.note).toContain("Making, Basics")
    expect(check({ memory: twice("nothing_to_share") })).toMatchObject({ kind: "repeating", allowBridge: false })
  })

  it("notices the same words reused and a stalled conversation", () => {
    expect(check({ memory: memory([
      { signalId: "s_music", turn: 1, question: "Q1?", buildsOn: "cutting a short film" },
      { signalId: "s_make", turn: 3, question: "Q2?", buildsOn: "a short film" }]) })).toMatchObject({ kind: "repeating" })
    expect(check({ quietTurns: 2 })).toMatchObject({ kind: "stalling" })
  })
})

describe("thread order for the open conversation", () => {
  const twoThings = "I've had the new record on all week, and I've been cutting a short film."
  const start = () => recordAnswer(emptyWorkingMemory(), { relation: "answered", answer: twoThings, turn: 1, signals, threads: [
    // Returned out of order on purpose: threads keep the applicant's order.
    { detail: "Film", quote: "I've been cutting a short film", relatedSignalIds: [] },
    { detail: "Record", quote: "I've had the new record on all week", relatedSignalIds: [] },
  ] })

  it("numbers threads in the order they were said, stays on the current one and holds the rest", () => {
    let memory = start()
    expect(memory.threads.map(thread => [thread.id, thread.detail])).toEqual([["t1", "Record"], ["t2", "Film"]])
    memory = recordQuestion(memory, { question: "Whose record?", buildsOn: "the new record", turn: 1 })
    expect(threadPlan(memory)).toMatchObject({ stay: true, current: { id: "t1" }, held: [{ id: "t2" }] })
    memory = recordAnswer(memory, { relation: "answered", answer: "Nala Sinephro. I played it to my flatmate.", turn: 2, signals, threads: [], finishedThreadIds: ["t1", "nonsense"] })
    expect(memory.threads[0].finishedAt).toBe(2)
    expect(threadPlan(memory)).toMatchObject({ stay: false, held: [{ id: "t2" }] })
    const notes = openConversationState({ signals, evidence: {}, memory, turnCount: 3, maxAnswers: 8, showAreas: false })
    expect(notes).toContain("is talked through")
    expect(notes).toContain("I've been cutting a short film")
  })

  it("lets a thread go after two unanswered questions", () => {
    let memory = start()
    memory = recordQuestion(memory, { question: "Whose record?", buildsOn: "the new record", turn: 1 })
    memory = recordQuestion(memory, { question: "Who did you play it to?", buildsOn: "the new record", turn: 2 })
    expect(threadPlan(memory)).toMatchObject({ stay: false, held: [{ id: "t2" }] })
  })

  it("holds the most relevant thread first and only talks a thread through once it was asked about", () => {
    let memory = recordAnswer(emptyWorkingMemory(), { relation: "answered", answer: twoThings, turn: 1, signals, threads: [
      { detail: "Record", quote: "I've had the new record on all week", relatedSignalIds: [], relevance: "low", whyItMatters: "listening only" },
      { detail: "Film", quote: "I've been cutting a short film", relatedSignalIds: [], relevance: "high", whyItMatters: "work done for a friend" },
    ] })
    expect(threadPlan(memory).held.map(thread => thread.id)).toEqual(["t2", "t1"])
    expect(memory.threads[1].whyItMatters).toBe("work done for a friend")
    memory = recordAnswer(memory, { relation: "answered", answer: "Nothing much.", turn: 2, signals, threads: [], finishedThreadIds: ["t1", "t2"] })
    expect(memory.threads.every(thread => !thread.finishedAt)).toBe(true)
  })

  it("keeps areas hidden until it is time to change subject, then keeps them shown", () => {
    const memory = start()
    expect(shouldShowAreas({ memory, unexplored: 2, turnCount: 2, maxAnswers: 12 })).toBe(false)
    expect(shouldShowAreas({ memory, unexplored: 2, turnCount: 9, maxAnswers: 12 })).toBe(true)
    const talkedThrough = { ...memory, threads: memory.threads.map(thread => ({ ...thread, finishedAt: 3 })) }
    expect(shouldShowAreas({ memory: talkedThrough, unexplored: 2, turnCount: 4, maxAnswers: 12 })).toBe(true)
    expect(shouldShowAreas({ memory: { ...memory, areasShownAt: 4 }, unexplored: 1, turnCount: 5, maxAnswers: 12 })).toBe(true)
    expect(shouldShowAreas({ memory: talkedThrough, unexplored: 0, turnCount: 4, maxAnswers: 12 })).toBe(false)
    expect(openConversationState({ signals, evidence: {}, memory, turnCount: 2, maxAnswers: 12, showAreas: false })).not.toContain("Music")
    expect(openConversationState({ signals, evidence: {}, memory, turnCount: 9, maxAnswers: 12, showAreas: true })).toContain("Music")
  })
})
