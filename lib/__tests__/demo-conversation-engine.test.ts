import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  create: vi.fn(), queue: vi.fn(),
  history: [] as Array<{ role: string; content: string; metadata: Record<string, unknown> }>,
  inserted: [] as Array<{ role: string; content: string; metadata: Record<string, unknown> }>,
}))
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: mocks.create } } }))
vi.mock("@/lib/llm-usage", () => ({ logLlmUsage: vi.fn() }))
vi.mock("@/lib/session-completion-jobs", () => ({ queueSessionCompletion: mocks.queue }))
vi.mock("@/lib/gatekeeper-models", () => ({ colorsThinConversationModel: () => "test-model", supportsForcedToolChoice: () => true }))
vi.mock("@/lib/supabase", () => ({ supabase: {
  from(table: string) {
    const chain = {
      select: () => chain, eq: () => chain,
      order: async () => ({ data: mocks.history, error: null }),
      maybeSingle: async () => ({ data: { id: "session-row", status: "active", applicant_email: "audit@example.com" }, error: null }),
      update: () => chain,
      insert(value: (typeof mocks.inserted)[number]) {
        if (table !== "messages") throw new Error("Unexpected write")
        mocks.inserted.push(value)
        return { error: null, select: () => ({ single: async () => ({ data: { id: "user-row" }, error: null }) }) }
      },
    }
    return chain
  },
} }))

import { conversationFacts, postConversation, type ConversationConfiguration } from "@/lib/conversation-engine"
import { CONVERSATION_ENGINE_MARKER, DEMO_CONVERSATION_PROFILES, demoConversationProfile, demoConversationPrompt, type DemoConversationId } from "@/lib/demo-conversation-profiles"
import type { ProjectContext } from "@/lib/project-resolution"
import { brokenMoConversation, moHistoryBefore } from "./fixtures/mo-nov6"
import { LEWISHAM_SOCIAL_PERSONA_PROMPT } from "@/lib/lewisham-social-persona"

const context = { organisationId: "org", projectId: "project", settings: { applicationExperience: { max_turns: 8 }, raw: {} } } as unknown as ProjectContext
function configuration(id: DemoConversationId = "loptimiste"): ConversationConfiguration {
  const profile = DEMO_CONVERSATION_PROFILES[id]
  return { id, marker: CONVERSATION_ENGINE_MARKER, model: "test-model", fields: profile.fields, choices: profile.choices,
    resolveChoice: profile.resolveChoice,
    formatReply: profile.formatReply,
    replyGuidance: profile.replyGuidance,
    preventRepeatedQuestions: profile.preventRepeatedQuestions, questionTopic: profile.questionTopic,
    wrapUpAnswers: profile.wrapUpAnswers, softCloseAnswers: profile.softCloseAnswers,
    closingMessage: profile.closing, completionMessage: profile.completion,
    buildPrompt: ({ turnCount }) => demoConversationPrompt(profile, `You are ${id}.\n\nCONVERSATION FLOW\nLegacy pass and reject rules.`, turnCount) }
}
function result(reply: string, close = false, extra = {}) {
  return { stop_reason: "tool_use", usage: {}, content: [{ type: "tool_use", name: "groucho_converse", input: {
    reply, close, boundary: "none", boundaryQuestion: "", addsNewContext: true, choiceKey: "none", facts: [], ...extra,
  } }] }
}
const run = (message = "A memory of woodsmoke.", id: DemoConversationId = "loptimiste") => postConversation({ context, sessionId: "demo-session", message, configuration: configuration(id), runCompletion: true })

beforeEach(() => {
  mocks.create.mockReset(); mocks.queue.mockReset(); mocks.inserted = []
  mocks.history = [{ role: "assistant", content: "Who is this for?", metadata: { conversation_engine: CONVERSATION_ENGINE_MARKER, conversation_profile: "loptimiste" } }]
})

describe("shared conversation runtime for public demos", () => {
  it("repairs a stalled active turn before saving a single exchange", async () => {
    mocks.create.mockResolvedValueOnce(result("That is a particular memory."))
      .mockResolvedValueOnce(result("Where would it burn?"))
    expect((await run()).status).toBe(200)
    expect(mocks.create).toHaveBeenCalledTimes(2)
    expect(mocks.inserted.map(entry => entry.role)).toEqual(["user", "assistant"])
    expect(mocks.inserted[1].content).toBe("Where would it burn?")
  })

  it("returns the server's approved options even when the model omits UI fields", async () => {
    mocks.create.mockResolvedValueOnce(result("Which sounds most like you?", false, { choiceKey: "ritual" }))
    const data = await (await run()).json()
    expect(data.ui).toMatchObject({ inputType: "singleSelect", options: [...DEMO_CONVERSATION_PROFILES.loptimiste.choices.ritual.options] })
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it.each(["Which track was it? I'm curious which one got you to take a look.", "Which one was it?", "What made you choose that track?", "What made you pick it?"])("accepts an ordinary open music question: %s", async reply => {
    mocks.history[0].metadata.conversation_profile = "lewisham-social"
    mocks.create.mockResolvedValueOnce(result(reply))
    const data = await (await run("A track", "lewisham-social")).json()
    expect(data.status).toBe("active")
    expect(data.ui.inputType).toBe("text")
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it("still repairs an unsupported choice list", async () => {
    mocks.create.mockResolvedValueOnce(result("Pick one from these options?"))
      .mockResolvedValueOnce(result("Where would it burn?"))
    expect((await run()).status).toBe(200)
    expect(mocks.create).toHaveBeenCalledTimes(2)
  })

  it.each(["invented", "__proto__", "constructor"])("repairs unregistered choice %s instead of returning an empty selector", async choiceKey => {
    mocks.create.mockResolvedValueOnce(result("Which one?", false, { choiceKey }))
      .mockResolvedValueOnce(result("Which sounds most like you?", false, { choiceKey: "ritual" }))
    expect((await (await run()).json()).ui.options).toHaveLength(4)
  })

  it("does not finish while required details are missing", async () => {
    mocks.create.mockResolvedValueOnce(result("Thank you.", true))
      .mockResolvedValueOnce(result("Where would it burn?"))
    expect((await (await run()).json()).status).toBe("active")
    expect(mocks.queue).not.toHaveBeenCalled()
  })

  it("finishes as a simulation without an approval secret, webhooks or completion jobs", async () => {
    mocks.history[0].metadata.conversation_details = { recipient: "For me", scentMemory: "Woodsmoke" }
    mocks.create.mockResolvedValueOnce(result("Evenings in your living room.", true, { facts: [{ key: "burnLocation", value: "Living room", sourceQuote: "living room" }] }))
    const data = await (await run("In my living room.")).json()
    expect(data).toMatchObject({ status: "completed", engine: CONVERSATION_ENGINE_MARKER, completion: { mode: "simulation", complete: true } })
    expect(data.secret).toBeUndefined()
    expect(data.reviewStatus).toBe("not_required")
    expect(mocks.inserted[1].metadata.colors_demo_report_status).toBeUndefined()
    expect(mocks.queue).not.toHaveBeenCalled()
  })

  it("accepts a selected option as a named fact without inferring it from prose", async () => {
    mocks.history[0].metadata.conversation_choice_key = "recipient"
    mocks.create.mockResolvedValueOnce(result("What smell stays with you?"))
    expect((await (await run("A gift")).json()).details.recipient).toBe("A gift")
  })

  it("repairs a repeated selector after its named field has been answered", async () => {
    mocks.history[0].metadata.conversation_profile = "saltings"
    mocks.history[0].metadata.conversation_choice_key = "attendance"
    mocks.history[0].metadata.conversation_details = { workingOn: "A novel", stuck: "The ending", wants: "Silence" }
    mocks.create.mockResolvedValueOnce(result("Can you be there for the full fortnight, 11 to 25 January?", false, { choiceKey: "attendance" }))
      .mockResolvedValueOnce(result("Would you share a line from the novel?"))
    const data = await (await run("Yes, the whole fortnight", "saltings")).json()
    expect(data.message).toBe("Would you share a line from the novel?")
    expect(data.details.attendance).toBe("Yes, the whole fortnight")
    expect(mocks.create).toHaveBeenCalledTimes(2)
  })

  it("respects a request to stop and marks missing details honestly", async () => {
    mocks.create.mockResolvedValueOnce(result("Thank you for your time.", true))
    expect((await (await run("No thanks, please stop.")).json()).completion.complete).toBe(false)
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it("closes an explicit stop question even if the model proposes another question", async () => {
    mocks.create.mockResolvedValueOnce(result("What scent do you remember?"))
    const data = await (await run("Can we stop?")).json()
    expect(data).toMatchObject({ status: "completed", completion: { complete: false } })
    expect(data.message).not.toContain("?")
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it("does not treat a memory of a bus stop as a request to end", async () => {
    mocks.create.mockResolvedValueOnce(result("Where would it burn?"))
    expect((await (await run("The bus stop by the sea.")).json()).status).toBe("active")
  })

  it("does not save the answer when repair fails", async () => {
    mocks.create.mockResolvedValue(result("An observation without a question."))
    expect((await run()).status).toBe(503)
    expect(mocks.inserted).toEqual([])
  })

  it("requires a new-engine session belonging to the configured profile", async () => {
    mocks.history[0].metadata.conversation_engine = "legacy"
    expect((await run()).status).toBe(409)
    mocks.history[0].metadata.conversation_engine = CONVERSATION_ENGINE_MARKER
    mocks.history[0].metadata.conversation_profile = "saltings"
    expect((await run()).status).toBe(409)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it.each(["connection", "otherInterests"])("keeps Mo listening when %s is missing despite complete ticket logistics", async missing => {
    mocks.history[0].metadata.conversation_profile = "lewisham-social"
    const details: Record<string, string> = { discovery: "A track", connection: "The guitar on Kitchen Light", otherInterests: "Small guitar gigs",
      companion: "My sister", location: "Bristol", night: "Bristol, Tue 13 Apr" }
    delete details[missing]
    mocks.history[0].metadata.conversation_details = details
    mocks.create.mockResolvedValueOnce(result("Thanks for telling me.", true))
      .mockResolvedValueOnce(result(missing === "connection" ? "What caught you in that track?" : "Who else have you been listening to lately?"))
    const data = await (await run("That covers the travel plans.", "lewisham-social")).json()
    expect(data.status).toBe("active")
    expect(mocks.create).toHaveBeenCalledTimes(2)
    expect(mocks.queue).not.toHaveBeenCalled()
  })

  it("captures connection and wider interests together without requiring separate survey answers", async () => {
    mocks.history[0].metadata.conversation_profile = "lewisham-social"
    mocks.history[0].metadata.conversation_details = { discovery: "A track", companion: "My sister", location: "Bristol", night: "Bristol, Tue 13 Apr" }
    mocks.create.mockResolvedValueOnce(result("The guitar and those small rooms stayed with you.", true, { facts: [
      { key: "connection", value: "The quiet guitar in Kitchen Light", sourceQuote: "the quiet guitar in Kitchen Light" },
      { key: "otherInterests", value: "Wolf Alice and small gigs", sourceQuote: "Wolf Alice and small gigs" },
    ] }))
    const data = await (await run("I love the quiet guitar in Kitchen Light. I'm also into Wolf Alice and small gigs.", "lewisham-social")).json()
    expect(data).toMatchObject({ status: "completed", details: { connection: "The quiet guitar in Kitchen Light", otherInterests: "Wolf Alice and small gigs" }, completion: { complete: true } })
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it("lets a newcomer decline to share interests without inventing fandom or blocking completion", async () => {
    mocks.history[0].metadata.conversation_profile = "lewisham-social"
    mocks.history[0].metadata.conversation_details = { discovery: "I've only just found you", companion: "Coming alone", location: "Bristol", night: "Bristol, Tue 13 Apr" }
    mocks.create.mockResolvedValueOnce(result("Thanks for having a look.", true, { facts: [
      { key: "connection", value: "Still exploring", sourceQuote: "Still exploring" },
      { key: "otherInterests", value: "Prefers not to share", sourceQuote: "I'd rather not share" },
    ] }))
    const data = await (await run("Still exploring. I'd rather not share other interests.", "lewisham-social")).json()
    expect(data).toMatchObject({ status: "completed", completion: { complete: true } })
    expect(data.secret).toBeUndefined()
    expect(mocks.queue).not.toHaveBeenCalled()
  })

  it("shows only London dates when travelling from Bristol to London", async () => {
    mocks.history[0].metadata.conversation_profile = "lewisham-social"
    mocks.create.mockResolvedValueOnce(result("Which night would you prefer?", false, { choiceKey: "night", facts: [
      { key: "location", value: "Bristol", sourceQuote: "Bristol" },
      { key: "preferredCity", value: "London", sourceQuote: "London" },
    ] }))
    const data = await (await run("Travelling from Bristol to the London show.", "lewisham-social")).json()
    expect(data.details).toMatchObject({ location: "Bristol", preferredCity: "London" })
    expect(data.ui.options).toEqual(["London, Sat 17 Apr", "London, Sun 18 Apr", "See other cities"])
    expect(data.message).toBe("London, then. What night would you prefer?")
  })

  it("expands other cities without recording navigation as a night or accepting model-invented facts", async () => {
    mocks.history[0].metadata.conversation_profile = "lewisham-social"
    mocks.history[0].metadata.conversation_choice_key = "night"
    mocks.history[0].metadata.conversation_details = { discovery: "A track", connection: "The guitars", otherInterests: "Muse",
      companion: "My partner", location: "Bristol", preferredCity: "London" }
    mocks.create.mockResolvedValueOnce(result("Thank you.", true, { addsNewContext: false, facts: [
      { key: "night", value: "Bristol, Tue 13 Apr", sourceQuote: "See other cities" },
    ] }))
    const data = await (await run("See other cities", "lewisham-social")).json()
    expect(data.status).toBe("active")
    expect(data.ui.options).toEqual([...DEMO_CONVERSATION_PROFILES["lewisham-social"].choices.night.options])
    expect(data.details.night).toBeUndefined()
    expect(data.details.preferredCity).toBe("London")
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it("keeps all tour dates available when only a travel origin is known", async () => {
    mocks.history[0].metadata.conversation_profile = "lewisham-social"
    mocks.create.mockResolvedValueOnce(result("Which night would you prefer?", false, { choiceKey: "night", facts: [
      { key: "location", value: "Bristol", sourceQuote: "Bristol" },
    ] }))
    const data = await (await run("Bristol", "lewisham-social")).json()
    expect(data.ui.options).toHaveLength(7)
    expect(data.details.preferredCity).toBeUndefined()
  })

  it("updates the destination when an exact night in another city is selected", async () => {
    mocks.history[0].metadata.conversation_profile = "lewisham-social"
    mocks.history[0].metadata.conversation_choice_key = "night"
    mocks.history[0].metadata.conversation_details = { discovery: "A track", connection: "The guitars", otherInterests: "Muse",
      companion: "My partner", location: "Bristol", preferredCity: "London" }
    mocks.create.mockResolvedValueOnce(result("Bristol on the 13th, then.", true))
    const data = await (await run("Bristol, Tue 13 Apr", "lewisham-social")).json()
    expect(data).toMatchObject({ status: "completed", details: { location: "Bristol", preferredCity: "Bristol", night: "Bristol, Tue 13 Apr" } })
  })

  it("normalises escaped line breaks before saving the closing message", async () => {
    mocks.history[0].metadata.conversation_details = { recipient: "For me", scentMemory: "Woodsmoke", burnLocation: "Living room" }
    mocks.create.mockResolvedValueOnce(result("Evenings in your living room.\\n\\n", true))
    const data = await (await run()).json()
    expect(data.message).toBe("Evenings in your living room.\n\nMerci for spending a little time with me.")
    expect(mocks.inserted[1].content).not.toContain("\\n")
  })

  it.each(["Last Bus Home is a good one to start with.", "Last Bus Home, good.", "A track, then.", "That sounds like a proper moment.", "That is a good ending to the night."])("removes Mo's stock approval before returning and saving the question: %s", async preamble => {
    mocks.history[0].metadata.conversation_profile = "lewisham-social"
    mocks.create.mockResolvedValueOnce(result(`${preamble} What stays with you about it?`))
    const data = await (await run("Last Bus Home", "lewisham-social")).json()
    expect(data.message).toBe("What stays with you about it?")
    expect(mocks.inserted[1].content).toBe(data.message)
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it.each(["I've got a soft spot for Same Again too. Who first put you onto it?", "I like how a good bassline holds that song together. What caught your ear?"])("preserves Mo's own opinion and the question that follows: %s", async reply => {
    mocks.history[0].metadata.conversation_profile = "lewisham-social"
    mocks.create.mockResolvedValueOnce(result(reply))
    expect((await (await run("Same Again", "lewisham-social")).json()).message).toBe(reply)
  })
})

describe("persona configuration and grounded state", () => {
  it.each(["loptimiste", "saltings", "lewisham-social"] as const)("preserves %s without importing COLORS or legacy outcome rules", id => {
    const prompt = configuration(id).buildPrompt({ applicationAudience: "community", hasApplicantDetails: false, turnCount: 1, shows: [] })
    expect(prompt).toContain(`You are ${id}`)
    expect(prompt).not.toContain("Legacy pass and reject rules")
    expect(prompt).not.toContain("COLORS")
    expect(prompt).toContain("exactly one answerable question")
  })

  it("requires the exact engine and an approved profile", () => {
    expect(demoConversationProfile({ conversation_engine: "conversation_v1", conversation_profile: "saltings" })?.id).toBe("saltings")
    expect(demoConversationProfile({ conversation_engine: "standard", conversation_profile: "saltings" })).toBeNull()
    expect(demoConversationProfile({ conversation_engine: "conversation_v1", conversation_profile: "invented" })).toBeNull()
  })

  it("drops unsupported quotes, unknown fields, invented nights and ambiguous London dates", () => {
    const fields = DEMO_CONVERSATION_PROFILES["lewisham-social"].fields
    expect(conversationFacts([
      { key: "night", value: "London, Sat 17 Apr", sourceQuote: "London" },
      { key: "location", value: "Paris", sourceQuote: "Paris" },
      { key: "unapproved", value: "yes", sourceQuote: "London" },
    ], "London", fields)).toEqual({})
    expect(conversationFacts([{ key: "night", value: "London, Sun 18 Apr", sourceQuote: "London, Sun 18 Apr" }], "London, Sun 18 Apr", fields)).toEqual({ night: "London, Sun 18 Apr" })
  })
})

describe("Mo's natural conversation and November 6 regression", () => {
  const natural = (message: string, onReplyDelta?: (reply: string) => void) => postConversation({ context, sessionId: "demo-session", message,
    configuration: configuration("lewisham-social"), onReplyDelta })

  it.each([5, 7, 9])("repairs the repeated question at transcript position %s without losing captured facts", async index => {
    mocks.history = moHistoryBefore(index)
    const answer = brokenMoConversation[index].content
    mocks.create.mockResolvedValueOnce(result("What caught your ear?", false, {
      facts: [{ key: "connection", value: answer, sourceQuote: answer }],
    })).mockResolvedValueOnce(result("The energy and the words, then. Who else have you been listening to lately?"))
    const delta = vi.fn()
    const data = await (await natural(answer, delta)).json()
    expect(data.message).toBe("The energy and the words, then. Who else have you been listening to lately?")
    expect(data.details.connection).toBe(answer)
    expect(mocks.create).toHaveBeenCalledTimes(2)
    expect(mocks.create.mock.calls[1][0].system).toContain("Do not ask it again or paraphrase the same request")
    expect(mocks.inserted[1].content).toBe(data.message)
    expect(delta).not.toHaveBeenCalled()
  })

  it("moves past a second generic attempt to pin down a song", async () => {
    mocks.history = moHistoryBefore(5)
    mocks.history.push({ role: "assistant", content: "Was there a particular moment or song that gave you that feeling?", metadata: {} })
    mocks.create.mockResolvedValueOnce(result("Do you have a favourite lyric or song where that comes through most?"))
      .mockResolvedValueOnce(result("The political edge, then. Who else have you been listening to?"))
    expect((await (await natural("the political sound")).json()).message).toBe("The political edge, then. Who else have you been listening to?")
    expect(mocks.create).toHaveBeenCalledTimes(2)
  })

  it("moves past a rephrased companion request from the live replay", async () => {
    mocks.history = moHistoryBefore(5)
    mocks.history.push({ role: "assistant", content: "Who would you bring along to a night?", metadata: {} })
    mocks.create.mockResolvedValueOnce(result("The hook and lyrics, got it. Who would you take along to a night, if anyone?"))
      .mockResolvedValueOnce(result("The lyrics matter to you too. Where are you travelling from?"))
    expect((await (await natural("the hook and lyrics")).json()).message).toBe("The lyrics matter to you too. Where are you travelling from?")
    expect(mocks.create).toHaveBeenCalledTimes(2)
  })

  it("does not confuse a specific gig follow-up with a broad listening request", () => {
    const topic = DEMO_CONVERSATION_PROFILES["lewisham-social"].questionTopic!
    expect(topic("Who else was in the room when the lights went out?")).toBeUndefined()
    expect(topic("What was it about that IDLES gig that stayed with you?")).toBeUndefined()
  })

  it.each([
    "What else have you had on lately, in your own words?",
    "Outside the band, what else has been on rotation lately?",
    "Which other bands or records have that same edge for you?",
    "Who else do you go back to when you want something loud?",
    "Is there other music you've been playing a lot lately, outside Lewisham Social?",
    "Outside the band, is there anything you've had on repeat lately?",
  ])("repairs an already offered listening request: %s", async question => {
    mocks.history = moHistoryBefore(5)
    mocks.history.push({ role: "assistant", content: "What's been on repeat for you since then, apart from Lewisham Social?", metadata: {} })
    mocks.create.mockResolvedValueOnce(result(question))
      .mockResolvedValueOnce(result("The words matter to you too. Who are you bringing along?"))
    expect((await (await natural("the political sound")).json()).message).toBe("The words matter to you too. Who are you bringing along?")
    expect(mocks.create).toHaveBeenCalledTimes(2)
    expect(mocks.create.mock.calls[1][0].system).toContain("new question must ask ONLY about")
  })

  it.each([
    "Who brought you along, and what did they say it would be like?",
    "Who brought you along, and was it a night you'd been looking forward to?",
  ])("keeps the first natural request from a compound question: %s", async question => {
    mocks.history = moHistoryBefore(1)
    mocks.create.mockResolvedValueOnce(result(`A friend's introduction, then. ${question}`))
    expect((await (await natural("Someone brought me along")).json()).message).toBe("A friend's introduction, then. Who brought you along?")
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it("does not let an acknowledgement disguise the same question", async () => {
    mocks.history = moHistoryBefore(5)
    mocks.create.mockResolvedValueOnce(result("The energy draws you in. What caught your ear?"))
      .mockResolvedValueOnce(result("Who else do you listen to?"))
    expect((await (await natural("the raw vibes")).json()).message).toBe("Who else do you listen to?")
    expect(mocks.create).toHaveBeenCalledTimes(2)
  })

  it("fails without saving or streaming a loop when all repairs repeat", async () => {
    mocks.history = moHistoryBefore(7)
    mocks.create.mockResolvedValue(result("What caught your ear?"))
    const delta = vi.fn()
    expect((await natural("the political sound", delta)).status).toBe(503)
    expect(mocks.create).toHaveBeenCalledTimes(3)
    expect(mocks.inserted).toEqual([])
    expect(delta).not.toHaveBeenCalled()
  })

  it("allows an explicit request to repeat the question", async () => {
    mocks.history = moHistoryBefore(5)
    mocks.create.mockResolvedValueOnce(result("What caught your ear?"))
    expect((await (await natural("Could you repeat the question?")).json()).message).toBe("What caught your ear?")
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it("preserves a natural acknowledgement and offers only approved London dates", async () => {
    mocks.history = moHistoryBefore(9)
    mocks.create.mockResolvedValueOnce(result("London it is. Which night would suit you?", false, { choiceKey: "night", facts: [
      { key: "location", value: "Bristol", sourceQuote: "Bristol" }, { key: "preferredCity", value: "London", sourceQuote: "London" },
    ] }))
    const data = await (await natural("Bristol to the London show.")).json()
    expect(data.ui.options).toEqual(["London, Sat 17 Apr", "London, Sun 18 Apr", "See other cities"])
    expect(data.message).toContain("London it is.")
    expect(data.message.match(/\?/g)).toHaveLength(1)
    expect(mocks.inserted[1].metadata.conversation_choice_key).toBe("night")
  })

  it("allows the date question again when the visitor changes destination", async () => {
    mocks.history = moHistoryBefore(5)
    mocks.history.push({ role: "assistant", content: "Which night would you prefer?", metadata: {
      conversation_details: { preferredCity: "London" }, conversation_choice_key: "night",
      ui: { options: ["London, Sat 17 Apr", "London, Sun 18 Apr", "See other cities"] },
    } })
    mocks.create.mockResolvedValueOnce(result("Bristol instead, then. Which night would you prefer?", false, { choiceKey: "night", facts: [
      { key: "preferredCity", value: "Bristol", sourceQuote: "Bristol" },
    ] }))
    const data = await (await natural("Actually, I want Bristol instead.")).json()
    expect(data.ui.options).toEqual(["Bristol, Tue 13 Apr", "See other cities"])
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it("keeps direct answers when showing exact night choices", async () => {
    mocks.history = moHistoryBefore(5)
    mocks.history.at(-1)!.metadata.conversation_details = { preferredCity: "London" }
    mocks.create.mockResolvedValueOnce(result("London is on 17 and 18 April 2027. Which night would suit you?", false, { choiceKey: "night" }))
    expect((await (await natural("What are the London dates?")).json()).message).toContain("London is on 17 and 18 April 2027.")
  })

  it("replaces obsolete stored catalogue instructions and uses free-form reply schema", async () => {
    const legacy = LEWISHAM_SOCIAL_PERSONA_PROMPT.replace(/ONE REQUEST PER TURN\n[\s\S]*?(?=\n\nBEFORE EACH REPLY)/,
      "ONE REQUEST PER TURN\nChoose questionIntent from the server catalogue. Set reply to Server supplies the turn.")
    const prompt = demoConversationPrompt(DEMO_CONVERSATION_PROFILES["lewisham-social"], legacy, 3)
    expect(prompt).not.toContain("Choose questionIntent")
    expect(prompt).not.toContain("Server supplies the turn")
    mocks.history = moHistoryBefore(5)
    mocks.create.mockResolvedValueOnce(result("The energy draws you in. Who else have you been listening to?"))
    await natural("the raw vibes")
    expect(mocks.create.mock.calls[0][0].tools[0].input_schema.properties).not.toHaveProperty("questionIntent")
  })
})
