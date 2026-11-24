import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
const mocks = vi.hoisted(() => ({
  create: vi.fn(), queue: vi.fn(), writes: [] as Array<Record<string, unknown>>,
  history: [] as Array<{ role: string; content: string; metadata: Record<string, unknown> }>,
  database: vi.fn(), actor: { kind: "member", userId: "author" } as { kind: "member"; userId: string } | null,
  denied: false, rateLimited: false,
}))
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: mocks.create } } }))
vi.mock("@/lib/llm-usage", () => ({ logLlmUsage: vi.fn() }))
vi.mock("@/lib/session-completion-jobs", () => ({ queueSessionCompletion: mocks.queue }))
vi.mock("@/lib/gatekeeper-models", () => ({ colorsThinConversationModel: () => "test-model", supportsForcedToolChoice: () => true }))
vi.mock("@/lib/admin-actor", () => ({ resolveAdminActor: async () => mocks.actor }))
vi.mock("@/lib/org-access", () => ({
  requireOrgAdmin: async () => mocks.denied ? NextResponse.json({ error: "Forbidden" }, { status: 403 }) : null,
  unauthorized: () => NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
}))
vi.mock("@/lib/platform-admin-access", () => ({ isSameOriginMutation: (r: Request) => r.headers.get("origin") !== "https://other.test" }))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ ok: !mocks.rateLimited }) }))
vi.mock("@/lib/supabase", () => ({ supabase: { from: (...args: unknown[]) => {
  mocks.database(...args)
  const q = {
    select: () => q, eq: () => q, update: () => q,
    order: async () => ({ data: mocks.history, error: null }),
    maybeSingle: async () => ({ data: { id: "session", status: "active", applicant_email: null }, error: null }),
    insert: (row: Record<string, unknown>) => { mocks.writes.push(row); return { error: null, select: () => ({ single: async () => ({ data: { id: "user" }, error: null }) }) } },
  }
  return q
} } }))
import { DEFAULT_PROJECT_CONVERSATION, validateProjectConversation, projectConversationSettings, readProjectConversation, type ProjectConversationConfig, type SignalProjectConversationConfig, DEFAULT_SIGNAL_CONVERSATION, upgradeProjectConversation } from "@/lib/project-conversation-config"
import { projectConversationConfiguration, projectConversationProfile } from "@/lib/project-conversation-runtime"
import { signProjectPreview, verifyProjectPreview } from "@/lib/project-conversation-preview"
import { emptySignalEvidence, mergeSignalEvidence } from "@/lib/project-conversation-evidence"
import { conversationSelections, postConversation, type ConversationTranscriptEntry } from "@/lib/conversation-engine"
import { postDemoConversation, demoConversationProfile } from "@/lib/demo-conversation-profiles"
import { normalizeProjectSettings, validateProjectSettings } from "@/lib/project-settings"
import { POST } from "@/app/api/admin/organisations/[orgId]/conversation-preview/route"

const config: ProjectConversationConfig = {
  ...DEFAULT_PROJECT_CONVERSATION, intent: "Help visitors describe what they want to make at our ceramics studio. No class catalogue or availability is supplied.",
  persona: { name: "Rowan", instructions: "Be warm, curious and concise. Beginners are welcome. Do not invent classes or prices." },
  questions: [
    { id: "q_idea", question: "What would you like to make?", type: "text", required: true, options: [] },
    { id: "q_experience", question: "Have you tried pottery before?", type: "singleSelect", required: true, options: ["First time", "I have tried it"] },
    { id: "q_interests", question: "What interests you?", type: "multiSelect", required: false, options: ["Bowls", "Mugs", "Tiles"] },
  ],
}
const context = { organisationId: "org", projectId: "project", apiKeyId: null, settings: normalizeProjectSettings(projectConversationSettings(config)) }
const params = { params: Promise.resolve({ orgId: "org" }) }
function request(body: unknown, origin = "https://example.test") {
  return new NextRequest("https://example.test/api/preview", { method: "POST", headers: { origin }, body: JSON.stringify(body) })
}
function reply(text: string, extra = {}) {
  return { stop_reason: "tool_use", usage: {}, content: [{ type: "tool_use", name: "groucho_converse", input: {
    reply: text, close: false, boundary: "none", boundaryQuestion: "", addsNewContext: true, choiceKey: "none", facts: [], signalEvidence: [], ...extra,
  } }] }
}
function opening(c: ProjectConversationConfig = config): ConversationTranscriptEntry[] {
  const runtime = projectConversationConfiguration(c)
  return [{ role: "assistant", content: projectConversationProfile(c).opening, metadata: { conversation_engine: runtime.marker, conversation_profile: runtime.id } }]
}
beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_KEY", "test-preview-secret")
  mocks.create.mockReset(); mocks.queue.mockReset(); mocks.database.mockReset(); mocks.writes = []
  mocks.actor = { kind: "member", userId: "author" }; mocks.denied = false; mocks.rateLimited = false
  mocks.history = opening(config)
})
afterEach(() => vi.unstubAllEnvs())

describe("client-authored project conversation contract", () => {
  it("round trips all six controls, without requiring a global persona or dropping unrelated settings", () => {
    const settings = { ...projectConversationSettings(config), integration: "preserved" }
    const saved = validateProjectSettings(settings)
    expect(saved.ok).toBe(true)
    if (!saved.ok) throw new Error(saved.error)
    expect(readProjectConversation(saved.settings)).toEqual(config)
    expect(saved.settings.integration).toBe("preserved")
    expect(demoConversationProfile(saved.settings)?.opening).toBe(`${config.openingMessage}\n\n${config.openingQuestion}`)
  })
  it.each([
    { maxAnswers: 0 }, { maxAnswers: 13 }, { maxAnswers: 1.5 }, { intent: "" }, { persona: { name: "", instructions: "Hi" } },
    { questions: [{ ...config.questions[1], options: ["One", "One"] }] },
    { questions: [{ ...config.questions[0], type: "unsupported" }] },
    { questions: [config.questions[0], config.questions[0]] },
  ])("rejects invalid configuration %j", patch => expect(validateProjectConversation({ ...config, ...patch }).ok).toBe(false))
  it("decodes existing SDK selections without guessing ambiguous labels", () => {
    expect(conversationSelections("Selected: Bowls, Mugs", ["Bowls", "Mugs"])).toEqual(["Bowls", "Mugs"])
    expect(conversationSelections('Captured: Bowls', ["Bowls"])).toBeNull()
    expect(conversationSelections("Selected: London, Friday, Mugs", ["London, Friday", "Mugs"])).toEqual(["London, Friday", "Mugs"])
    expect(conversationSelections("Selected: Bowls, Mugs", ["Bowls, Mugs", "Bowls", "Mugs"])).toBeNull()
    expect(conversationSelections('["Bowls","Unknown"]', ["Bowls"])).toBeNull()
  })
  it("rejects a custom flow configured on another engine or project type", () => {
    expect(validateProjectSettings({ ...projectConversationSettings(config), conversation_engine: "colors_forum" }).ok).toBe(false)
    expect(validateProjectSettings({ ...projectConversationSettings(config), project_type: "onboarding" }).ok).toBe(false)
  })
  it("pins sessions to the complete configuration including the persona", () => {
    expect(projectConversationProfile(config).id).not.toBe(projectConversationProfile({ ...config, persona: { ...config.persona, instructions: "A new character" } }).id)
  })
})

describe("isolated draft preview", () => {
  it("rejects unsigned, altered, expired, cross-user and cross-organisation transcripts", () => {
    const snapshot = { config, organisationId: "org", actor: "member:author", expiresAt: Date.now() + 60000, transcript: opening(), status: "active" as const }
    const token = signProjectPreview(snapshot)
    expect(verifyProjectPreview(token, "org", "member:author")).toEqual(snapshot)
    expect(verifyProjectPreview(token, "other", "member:author")).toBeNull()
    expect(verifyProjectPreview(token, "org", "member:other")).toBeNull()
    expect(verifyProjectPreview(token + "x", "org", "member:author")).toBeNull()
    expect(verifyProjectPreview(signProjectPreview({ ...snapshot, expiresAt: Date.now() - 1 }), "org", "member:author")).toBeNull()
    expect(verifyProjectPreview("unsigned", "org", "member:author")).toBeNull()
  })
  it("requires an authenticated organisation admin, same origin and rate limit", async () => {
    mocks.actor = null
    expect((await POST(request({ action: "start", config }), params)).status).toBe(401)
    mocks.actor = { kind: "member", userId: "author" }; mocks.denied = true
    expect((await POST(request({ action: "start", config }), params)).status).toBe(403)
    mocks.denied = false
    expect((await POST(request({ action: "start", config }, "https://other.test"), params)).status).toBe(403)
    mocks.rateLimited = true
    expect((await POST(request({ action: "start", config }), params)).status).toBe(429)
    expect(mocks.database).not.toHaveBeenCalled()
  })
  it("keeps the exact original configuration after a client supplies a different draft on a later turn", async () => {
    const started = await (await POST(request({ action: "start", config }), params)).json()
    mocks.create.mockResolvedValue(reply("What would you like to make?"))
    const response = await POST(request({ action: "message", token: started.token, message: "I'd like to try pottery.", config: { ...config, intent: "Replacement" } }), params)
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.previewTranscript).toBeUndefined()
    expect(mocks.create.mock.calls[0][0].system).toContain(config.intent)
    expect(mocks.create.mock.calls[0][0].system).toContain(config.persona.instructions)
    expect(mocks.create.mock.calls[0][0].system).toContain("Leave it empty when the question can stand on its own.")
    expect(mocks.create.mock.calls[0][0].system).not.toContain("Replacement")
    expect(verifyProjectPreview(result.token, "org", "member:author")?.transcript).toHaveLength(3)
    expect(mocks.database).not.toHaveBeenCalled(); expect(mocks.queue).not.toHaveBeenCalled()
  })
  it("returns retryable model errors without advancing the signed transcript", async () => {
    const started = await (await POST(request({ action: "start", config }), params)).json()
    mocks.create.mockRejectedValue(new Error("temporary"))
    const response = await POST(request({ action: "message", token: started.token, message: "Hi" }), params)
    expect(response.status).toBe(503)
    expect((await response.json()).token).toBeUndefined()
    expect(verifyProjectPreview(started.token, "org", "member:author")?.transcript).toHaveLength(1)
    expect(mocks.database).not.toHaveBeenCalled()
  })
  it("shows a possible authored conflict to the preview author without adding it to the conversation", async () => {
    const started = await (await POST(request({ action: "start", config }), params)).json()
    const settingsConflict = "The persona asks for both a recap and no paraphrasing."
    mocks.create.mockResolvedValueOnce(reply("What would you like to make?", { settingsConflict }))
      .mockResolvedValueOnce(reply("Take your time.", { settingsConflict }))
    const first = await (await POST(request({ action: "message", token: started.token, message: "I want to try pottery." }), params)).json()
    expect(first).toMatchObject({ message: "What would you like to make?", settingsConflict })
    const saved = verifyProjectPreview(first.token, "org", "member:author")
    expect(JSON.stringify(saved?.transcript)).not.toContain(settingsConflict)
    expect(mocks.create.mock.calls[0][0].tools[0].input_schema.properties).toHaveProperty("settingsConflict")
    const later = await (await POST(request({ action: "message", token: first.token, message: "I’m still thinking." }), params)).json()
    expect(later).toMatchObject({ message: "Take your time.", status: "active" })
    expect(later).not.toHaveProperty("settingsConflict")
    expect(mocks.create.mock.calls[1][0].tools[0].input_schema.properties).not.toHaveProperty("settingsConflict")
  })
  it("uses the identical prompt, options and visible response in preview and the saved project's runtime", async () => {
    mocks.create.mockResolvedValue(reply("Have you tried pottery before?", { choiceKey: "q_experience" }))
    const live = await (await postDemoConversation({ context, sessionId: "live-session", message: "A bowl." })).json()
    const livePrompt = mocks.create.mock.calls[0][0]
    const preview = await (await postConversation({ context, sessionId: "draft", message: "A bowl.", previewTranscript: opening(), configuration: projectConversationConfiguration(config) })).json()
    const previewPrompt = mocks.create.mock.calls[1][0]
    expect(preview.previewTranscript).toHaveLength(3)
    const visible = { ...preview }; delete visible.previewTranscript
    expect(visible).toEqual(live); expect(previewPrompt).toEqual(livePrompt)
    expect(live.ui).toMatchObject({ inputType: "singleSelect", options: ["First time", "I have tried it"] })
    expect(mocks.queue).not.toHaveBeenCalled()
  })
})

describe("complete custom conversations", () => {
  it("handles out-of-order details, a correction, multi-select and a respectful stop with no application jobs", async () => {
    let history = opening()
    const turn = async (message: string) => {
      const response = await postConversation({ context, sessionId: "preview", message, previewTranscript: history, configuration: projectConversationConfiguration(config) })
      expect(response.status).toBe(200)
      const result = await response.json(); history = result.previewTranscript; return result
    }
    mocks.create.mockResolvedValueOnce(reply("A useful bowl gives us somewhere to start. Have you tried pottery before?", {
      choiceKey: "q_experience", choiceIntroduction: "A useful bowl gives us somewhere to start.", facts: [{ key: "q_idea", value: "A bowl", sourceQuote: "A bowl" }],
    }))
    const first = await turn("A bowl for breakfast.")
    expect(first.details.q_idea).toBe("A bowl")
    expect(first.message).toBe("A useful bowl gives us somewhere to start.\n\nHave you tried pottery before?")
    mocks.create.mockResolvedValueOnce(reply("What interests you?", { choiceKey: "q_interests" }))
    expect((await turn("First time")).details.q_experience).toBe("First time")
    mocks.create.mockResolvedValueOnce(reply("How would you use those pieces?"))
    const selection = await turn('["Bowls","Mugs"]')
    expect(selection.details.q_interests).toBe("Bowls; Mugs")
    mocks.create.mockResolvedValueOnce(reply("A mug for your brother. What would make it useful for him?", {
      facts: [{ key: "q_idea", value: "A mug for my brother", sourceQuote: "A mug for my brother" }],
    }))
    expect((await turn("Actually, A mug for my brother, not a bowl for me.")).details.q_idea).toBe("A mug for my brother")
    mocks.create.mockResolvedValueOnce(reply("Thanks for telling me about the mug.", { close: true }))
    const ended = await turn("Can we stop?")
    expect(ended.status).toBe("completed")
    expect(ended.ui.options ?? []).toEqual([])
    expect(ended.message).not.toContain("?")
    expect(mocks.database).not.toHaveBeenCalled(); expect(mocks.queue).not.toHaveBeenCalled()
  })
  it("enforces the exact answer ceiling even on a visitor question and an attempted consent detour", async () => {
    const limited = { ...config, maxAnswers: 1 }
    mocks.create.mockResolvedValue(reply("No prices are supplied. Would you give permission?", { boundary: "consent", boundaryQuestion: "Would you give permission?" }))
    const response = await postConversation({ context, sessionId: "preview", message: "How much is a class?", previewTranscript: opening(limited), configuration: projectConversationConfiguration(limited) })
    const result = await response.json()
    expect(result.status).toBe("completed")
    expect(result.completion).toMatchObject({ mode: "conversation", complete: false })
    expect(result.message).not.toContain("?")
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
  it("honours a semantic request to stop even when the model proposes another question", async () => {
    mocks.create.mockResolvedValue(reply("Is there anything else?", { visitorIntent: "stop" }))
    const response = await postConversation({ context, sessionId: "preview", message: "I would rather not say any more.", previewTranscript: opening(), configuration: projectConversationConfiguration(config) })
    const result = await response.json()
    expect(result.status).toBe("completed")
    expect(result.message).not.toContain("?")
    expect(result.completion.complete).toBe(false)
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
  it("retains the full short conversation for continuity near the answer limit", async () => {
    const longConfig = { ...config, maxAnswers: 12 }
    const history = opening(longConfig)
    for (let index = 0; index < 10; index++) history.push({ role: "user", content: index === 0 ? "My brother collects blue pottery." : `Detail ${index}`, metadata: {} }, { role: "assistant", content: "What else would help?", metadata: {} })
    mocks.create.mockResolvedValue(reply("How would he use the piece?"))
    const response = await postConversation({ context, sessionId: "preview", message: "I am thinking about a gift.", previewTranscript: history, configuration: projectConversationConfiguration(longConfig) })
    expect(response.status).toBe(200)
    expect(mocks.create.mock.calls[0][0].messages).toContainEqual({ role: "user", content: "My brother collects blue pottery." })
  })
  it("requires a new session after an opening, intent or persona change", async () => {
    const changed = { ...config, intent: "Another purpose" }
    const response = await postConversation({ context, sessionId: "preview", message: "Hi", previewTranscript: opening(), configuration: projectConversationConfiguration(changed) })
    expect(response.status).toBe(409); expect(mocks.create).not.toHaveBeenCalled()
  })
})

const signalConfig: SignalProjectConversationConfig = {
  ...DEFAULT_SIGNAL_CONVERSATION,
  intent: "Understand community participation. Different kinds of involvement are welcome. No acceptance rules or verified event data are supplied.",
  persona: { name: "Alex", instructions: "Be warm and curious. Notice a concrete detail, acknowledge corrections, and respect privacy." },
  signals: [{ id: "s_community", name: "Community participation", understanding: "How they show up or contribute in a community.", evidence: "Their involvement and why it matters. A name can add detail but is not proof.", examples: ["I organise dinners at Cedar Hall.", "I help welcome members to an online group."], explore: true, question: "", answerType: "auto", options: [] },
    { id: "s_hopes", name: "Hopes for joining", understanding: "What they hope to find or contribute.", evidence: "Their own hopes, including uncertainty.", examples: [], explore: false, question: "", answerType: "auto", options: [] }],
}
const evidenceUpdate = (quote: string, extra = {}) => ({ signalId: "s_community", status: "evidence_found", subject: "applicant", summary: "Regular involvement in a community gathering.", reason: "They describe their own participation and motivation.", quotes: [quote], supersedes: false, ...extra })

describe("signal configuration and compatibility", () => {
  it("preserves legacy application settings while enabling the existing COLORS review pipeline", () => {
    const application = { ...signalConfig, applicationReview: "colors_forum" as const }
    const legacy = { opening_message: "Original opening", max_turns: 9, required_signals: ["Original signal"] }
    const settings = { application_experience: legacy, persona_id: "original-persona", decision_policy: { automatic_acceptance_enabled: false }, webhook_url: "https://example.test/hook", ...projectConversationSettings(application) }
    expect(validateProjectSettings(settings).ok).toBe(true)
    expect(settings.application_experience).toBe(legacy)
    expect(readProjectConversation(settings)).toEqual(application)
    expect(projectConversationConfiguration(application)).toMatchObject({ marker: "colors_thin_pilot_v1", completionMessage: undefined })
    expect(validateProjectConversation({ ...application, applicationReview: "unknown" }).ok).toBe(false)
  })
  it("preserves old revisions and canonicalises equivalent project settings regardless of key order", () => {
    expect(projectConversationProfile(signalConfig).id).toBe(`project:${createHash("sha256").update(JSON.stringify(signalConfig)).digest("hex")}`)
    const authored = { ...signalConfig, projectContext: "A community project", closingMessage: "Thanks for chatting." }
    const reordered = { closingMessage: authored.closingMessage, projectContext: authored.projectContext, ...signalConfig }
    expect(projectConversationProfile(authored).id).toBe(projectConversationProfile(reordered).id)
  })
  it("round trips project context, progression and closing controls through saved settings", () => {
    const authored = { ...signalConfig, openingQuestion: "What brought you to this project?", projectContext: "Online gatherings are free. Dates are not yet announced.", conversationGuidance: "Start with their interests, then explore community participation. Leave room for their questions.", closingGuidance: "Acknowledge their interests without making a decision.", closingMessage: "Thanks for exploring the project with us." }
    const result = validateProjectSettings(projectConversationSettings(authored))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(readProjectConversation(result.settings)).toEqual(authored)
    expect(projectConversationConfiguration(authored).closingMessage).toBe(authored.closingMessage)
  })
  it.each([
    { projectContext: "x".repeat(6001) }, { projectContext: 3 },
    { conversationGuidance: "x".repeat(3001) }, { closingGuidance: null },
    { closingMessage: "Anything else?" }, { closingMessage: "x".repeat(501) },
  ])("rejects invalid project flow controls %j", patch => {
    expect(validateProjectConversation({ ...signalConfig, ...patch }).ok).toBe(false)
  })
  it("does not attach a signal's answer buttons to an independent project opening question", async () => {
    const authored: SignalProjectConversationConfig = { ...signalConfig, openingQuestion: "What brought you here?", signals: [{ ...signalConfig.signals[0], question: "How do you participate?", answerType: "singleSelect", options: ["Hosting", "Joining"] }] }
    const started = await (await POST(request({ action: "start", config: authored }), params)).json()
    expect(started.message).toBe(`${authored.openingMessage}\n\nWhat brought you here?`)
    expect(started.ui.inputType).toBe("text")
    expect(started.ui.options ?? []).toEqual([])
    expect(projectConversationProfile(authored).choices.s_community.options).toEqual(["Hosting", "Joining"])
  })
  it.each(["projectContext", "conversationGuidance", "closingGuidance", "closingMessage", "openingQuestion"] as const)("requires a new session when %s changes", async key => {
    const changed = { ...signalConfig, [key]: "A different project setting." }
    const result = await postConversation({ context, sessionId: "preview", message: "Hello", previewTranscript: opening(signalConfig), configuration: projectConversationConfiguration(changed) })
    expect(result.status).toBe(409)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it("round trips signals and examples without requiring exact questions or answer formats", () => {
    const result = validateProjectConversation(signalConfig)
    expect(result).toEqual({ ok: true, config: signalConfig })
    const saved = validateProjectSettings({ ...projectConversationSettings(signalConfig), integration: "keep" })
    expect(saved.ok).toBe(true)
    if (!saved.ok) throw new Error(saved.error)
    expect(readProjectConversation(saved.settings)).toEqual(signalConfig)
    expect(saved.settings.integration).toBe("keep")
    expect(projectConversationProfile(signalConfig).choices).toEqual({})
    expect(projectConversationProfile(signalConfig).opening).toContain("community participation?")
  })
  it("defaults omitted optional wording and answer controls without requiring client code", () => {
    const { openingQuestion: omittedOpening, ...base } = signalConfig
    expect(omittedOpening).toBe("")
    const result = validateProjectConversation({ ...base, signals: [{ id: "s_community", name: "Community", understanding: "Their involvement" }] })
    expect(result.ok).toBe(true)
    if (!result.ok || result.config.version !== 2) throw new Error("Expected signal configuration")
    expect(result.config.signals[0]).toMatchObject({ question: "", answerType: "auto", options: [], examples: [], evidence: "", explore: true })
  })
  it("upgrades old question settings explicitly without changing their exact wording or options", () => {
    const original = JSON.stringify(config)
    const upgraded = upgradeProjectConversation(config)
    expect(upgraded.version).toBe(2)
    expect(upgraded.openingQuestion).toBe(config.openingQuestion)
    expect(upgraded.signals[1]).toMatchObject({ id: config.questions[1].id, question: config.questions[1].question, answerType: "singleSelect", options: config.questions[1].options, explore: true })
    expect(JSON.stringify(config)).toBe(original)
    expect(projectConversationProfile(config).id).not.toBe(projectConversationProfile(upgraded).id)
  })
  it.each([
    { signals: [{ ...signalConfig.signals[0], name: "" }] },
    { signals: [{ ...signalConfig.signals[0], understanding: "" }] },
    { signals: [signalConfig.signals[0], signalConfig.signals[0]] },
    { signals: [{ ...signalConfig.signals[0], examples: Array(7).fill("Example") }] },
    { signals: [{ ...signalConfig.signals[0], answerType: "singleSelect", options: ["One"] }] },
    { signals: [{ ...signalConfig.signals[0], answerType: "unsupported" }] },
  ])("rejects invalid signal settings %j", patch => expect(validateProjectConversation({ ...signalConfig, ...patch }).ok).toBe(false))
  it("registers optional opening choices identically for preview and saved starts", async () => {
    const selectedConfig: SignalProjectConversationConfig = { ...signalConfig, signals: [{ ...signalConfig.signals[0], question: "How do you usually participate?", answerType: "multiSelect", options: ["Organising", "Taking part"] }] }
    const started = await (await POST(request({ action: "start", config: selectedConfig }), params)).json()
    expect(started.ui).toMatchObject({ inputType: "multiSelect", options: ["Organising", "Taking part"] })
    const profile = projectConversationProfile(selectedConfig)
    expect(profile.openingChoice).toBe("s_community")
    expect(profile.choices.s_community.question).toBe("How do you usually participate?")
    expect(verifyProjectPreview(started.token, "org", "member:author")?.transcript[0].metadata.conversation_choice_key).toBe("s_community")
  })
})

describe("grounded signal evidence", () => {
  it("starts with unknown signals and no invented evidence", () => {
    expect(emptySignalEvidence(signalConfig.signals).s_community).toEqual({ status: "not_explored", summary: "", reason: "", sources: [] })
  })
  it.each([
    evidenceUpdate("An example from the client"),
    evidenceUpdate("Cedar Hall", { subject: "other" }),
    evidenceUpdate("Cedar Hall", { signalId: "s_invented" }),
    evidenceUpdate("Cedar Hall", { status: "accepted" }),
    evidenceUpdate("Cedar Hall", { quotes: ["Cedar Hall", "Invented quote"] }),
  ])("rejects ungrounded, misattributed or unregistered evidence %j", update => {
    const result = mergeSignalEvidence({}, [update], "My friend goes to Cedar Hall.", 1, signalConfig.signals)
    expect(result.s_community.status).toBe("not_explored")
    expect(result.s_community.sources).toEqual([])
  })
  it("keeps source answer references and replaces a corrected interpretation", () => {
    const first = mergeSignalEvidence({}, [evidenceUpdate("I go weekly.", { status: "partly_understood" })], "I go weekly.", 1, signalConfig.signals)
    expect(first.s_community.sources).toEqual([{ quote: "I go weekly.", turn: 1 }])
    const second = mergeSignalEvidence(first, [evidenceUpdate("It helps me feel at home.")], "It helps me feel at home.", 2, signalConfig.signals)
    expect(second.s_community.sources).toHaveLength(2)
    const corrected = mergeSignalEvidence(second, [evidenceUpdate("That was my sister, not me.", { status: "not_explored", supersedes: true, summary: "The earlier account referred to their sister.", reason: "Their own involvement remains unknown." })], "That was my sister, not me.", 3, signalConfig.signals)
    expect(corrected.s_community.status).toBe("not_explored")
    expect(corrected.s_community.sources).toEqual([{ quote: "That was my sister, not me.", turn: 3 }])
    expect(corrected.s_hopes.status).toBe("not_explored")
  })
  it("records a refusal without treating it as a negative suitability judgment", () => {
    const result = mergeSignalEvidence({}, [evidenceUpdate("I'd rather keep that private.", { status: "declined", summary: "They prefer not to share.", reason: "Respect their privacy." })], "I'd rather keep that private.", 1, signalConfig.signals)
    expect(result.s_community.status).toBe("declined")
    expect(result.s_community.summary).not.toMatch(/fail|reject|unsuitable/)
  })
})

describe("complete signal conversations", () => {
  it("queues private application processing on a saved application close, while preview stays isolated", async () => {
    const application = { ...signalConfig, applicationReview: "colors_forum" as const }
    const liveContext = { ...context, settings: normalizeProjectSettings(projectConversationSettings(application)) }
    mocks.history = opening(application)
    mocks.create.mockResolvedValue(reply("We can stop here.", { visitorIntent: "stop" }))
    const live = await (await postDemoConversation({ context: liveContext, sessionId: "stored", message: "Please stop." })).json()
    expect(live).toMatchObject({ status: "completed", reviewStatus: "pending" })
    expect(live.completion).toBeUndefined()
    expect(mocks.queue).toHaveBeenCalledTimes(1)
    mocks.queue.mockClear(); mocks.database.mockClear()
    const preview = await (await postConversation({ context: liveContext, sessionId: "preview", message: "Please stop.", previewTranscript: opening(application), configuration: projectConversationConfiguration(application), runCompletion: false })).json()
    expect(preview.status).toBe("completed")
    expect(mocks.queue).not.toHaveBeenCalled()
    expect(mocks.database).not.toHaveBeenCalled()
  })
  it("continues an application with its opening snapshot after the client changes the project", async () => {
    const application = { ...signalConfig, applicationReview: "colors_forum" as const }
    const changed = { ...application, intent: "A new project objective" }
    mocks.history = opening(application)
    mocks.history[0].metadata.project_conversation = application
    mocks.create.mockResolvedValue(reply("What keeps you coming back?"))
    const liveContext = { ...context, settings: normalizeProjectSettings(projectConversationSettings(changed)) }
    const response = await postDemoConversation({ context: liveContext, sessionId: "stored", message: "I host an online group." })
    expect(response.status).toBe(200)
    expect(mocks.create.mock.calls[0][0].system).toContain(application.intent)
    expect(mocks.create.mock.calls[0][0].system).not.toContain(changed.intent)
  })
  it("keeps a closing turn retryable without persisting stale evidence when its evidence review fails", async () => {
    mocks.create.mockResolvedValueOnce(reply("We can stop here.", { visitorIntent: "stop" }))
    mocks.create.mockRejectedValueOnce(new Error("Temporary evidence review failure"))
    const response = await postConversation({ context, sessionId: "preview", message: "Please stop here.", previewTranscript: opening(signalConfig), configuration: projectConversationConfiguration(signalConfig) })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ retryable: true })
    expect(mocks.database).not.toHaveBeenCalled()
    expect(mocks.queue).not.toHaveBeenCalled()
  })
  it("replaces superseded evidence when a correction and stop arrive in the same final answer", async () => {
    const history = opening(signalConfig)
    mocks.create.mockResolvedValueOnce(reply("What matters about that group?", { signalEvidence: [evidenceUpdate("I run the group online.")] }))
    const first = await (await postConversation({ context, sessionId: "preview", message: "I run the group online.", previewTranscript: history, configuration: projectConversationConfiguration(signalConfig) })).json()
    mocks.create.mockResolvedValueOnce(reply("Thanks for correcting that.", { visitorIntent: "stop", signalEvidence: [] }))
    mocks.create.mockResolvedValueOnce(reply("Evidence reviewed.", { signalEvidence: [evidenceUpdate("I run the group in person, not online.", { supersedes: true, summary: "Runs an in-person group.", reason: "Their explicit correction replaces the online account." })] }))
    const final = await (await postConversation({ context, sessionId: "preview", message: "I run the group in person, not online. Please stop here.", previewTranscript: first.previewTranscript, configuration: projectConversationConfiguration(signalConfig) })).json()
    expect(final.status).toBe("completed")
    expect(final.message).not.toContain("?")
    expect(final.signalEvidence.s_community.sources).toEqual([{ quote: "I run the group in person, not online.", turn: 2 }])
    expect(final.signalEvidence.s_community.summary).toBe("Runs an in-person group.")
  })
  it("uses project guidance and context identically in preview and saved execution", async () => {
    const authored = { ...signalConfig, persona: { ...signalConfig.persona, instructions: "Answer a direct question without adding a follow-up." }, projectContext: "Gatherings are online and free. No schedule has been announced.", conversationGuidance: "Start with their interests; leave room for a question before closing.", closingGuidance: "Briefly acknowledge what they shared.", closingMessage: "Thank you for exploring this community." }
    const liveContext = { ...context, settings: normalizeProjectSettings(projectConversationSettings(authored)) }
    mocks.history = opening(authored)
    mocks.create.mockResolvedValue(reply("No schedule has been announced."))
    const message = "When are the gatherings?"
    const live = await (await postDemoConversation({ context: liveContext, sessionId: "stored", message })).json()
    const liveRequest = mocks.create.mock.calls[0][0]
    const preview = await (await postConversation({ context: liveContext, sessionId: "preview", message, previewTranscript: opening(authored), configuration: projectConversationConfiguration(authored) })).json()
    const visible = { ...preview }; delete visible.previewTranscript
    expect(visible).toEqual(live)
    expect(live).toMatchObject({ message: "No schedule has been announced.", status: "active" })
    expect(mocks.create.mock.calls[1][0]).toEqual(liveRequest)
    expect(liveRequest.tools[0].input_schema.properties).not.toHaveProperty("settingsConflict")
    expect(liveRequest.system).toContain(authored.persona.instructions)
    for (const value of [authored.projectContext, authored.conversationGuidance, authored.closingGuidance, authored.closingMessage]) expect(liveRequest.system).toContain(value)
    expect(mocks.queue).not.toHaveBeenCalled()
  })
  it.each(["stop", "limit"])("prioritises %s over unfinished flow guidance and uses the configured final statement", async mode => {
    const authored = { ...signalConfig, maxAnswers: mode === "limit" ? 1 : 8, conversationGuidance: "Always ask about both signals.", closingGuidance: "Ask if they have any questions before ending.", closingMessage: "Thank you for exploring this community." }
    mocks.create.mockResolvedValue(reply("What else would you like to share?", mode === "stop" ? { visitorIntent: "stop" } : {}))
    const result = await (await postConversation({ context, sessionId: "preview", message: mode === "stop" ? "I'd like to stop now." : "Hello", previewTranscript: opening(authored), configuration: projectConversationConfiguration(authored) })).json()
    expect(result.status).toBe("completed")
    expect(result.message).toBe(authored.closingMessage)
    expect(result.completion.complete).toBe(false)
    expect(result.signalEvidence.s_community.status).toBe("not_explored")
    expect(mocks.create).toHaveBeenCalledTimes(2)
  })
  it("carries partial context, adds motivation, handles corrections and closes on a refusal to continue", async () => {
    let history = opening(signalConfig)
    const runSignalTurn = async (message: string) => {
      const response = await postConversation({ context, sessionId: "signals", message, previewTranscript: history, configuration: projectConversationConfiguration(signalConfig) })
      expect(response.status).toBe(200)
      const result = await response.json(); history = result.previewTranscript; return result
    }
    mocks.create.mockResolvedValueOnce(reply("What keeps you coming back?", { signalEvidence: [evidenceUpdate("I go to Cedar Hall most Thursdays.", { status: "partly_understood", summary: "Regular attendance at Cedar Hall.", reason: "Their motivation is not yet clear." })] }))
    const first = await runSignalTurn("I go to Cedar Hall most Thursdays.")
    expect(first.signalEvidence.s_community.status).toBe("partly_understood")
    expect(first.signalEvidence.s_hopes.status).toBe("not_explored")
    mocks.create.mockResolvedValueOnce(reply("Welcoming newcomers is part of it. What do you usually do when someone arrives?", { signalEvidence: [evidenceUpdate("I introduce newcomers because it helped me feel at home.")] }))
    const second = await runSignalTurn("I introduce newcomers because it helped me feel at home.")
    expect(second.signalEvidence.s_community.sources.map((s: { turn: number }) => s.turn)).toEqual([1, 2])
    expect(history.filter(e => e.metadata.conversation_signal_evidence)).toHaveLength(1)
    mocks.create.mockResolvedValueOnce(reply("Thanks for correcting that. Where do you take part yourself?", { signalEvidence: [evidenceUpdate("That was my sister, not me.", { status: "not_explored", supersedes: true, summary: "The story was about their sister.", reason: "Their own participation is still unknown." })] }))
    const corrected = await runSignalTurn("That was my sister, not me.")
    expect(corrected.signalEvidence.s_community.status).toBe("not_explored")
    expect(corrected.signalEvidence.s_community.sources).toHaveLength(1)
    mocks.create.mockResolvedValueOnce(reply("Of course, we can leave it there.", { visitorIntent: "stop" }))
    mocks.create.mockResolvedValueOnce(reply("Evidence reviewed.", { signalEvidence: [] }))
    const final = await runSignalTurn("I would rather not say more.")
    expect(final.status).toBe("completed")
    expect(final.completion.complete).toBe(false)
    expect(final.message).not.toContain("?")
    expect(mocks.database).not.toHaveBeenCalled(); expect(mocks.queue).not.toHaveBeenCalled()
  })
  it("permits an honest incomplete close when uncertainty leaves no useful follow-up", async () => {
    mocks.create.mockResolvedValue(reply("Thank you for sharing what you can.", { close: true, signalEvidence: [evidenceUpdate("I don't know yet.", { status: "partly_understood", summary: "They are unsure.", reason: "No further detail was supplied." })] }))
    const response = await postConversation({ context, sessionId: "signals", message: "I don't know yet.", previewTranscript: opening(signalConfig), configuration: projectConversationConfiguration(signalConfig) })
    const result = await response.json()
    expect(result.status).toBe("completed")
    expect(result.completion.complete).toBe(false)
    expect(mocks.create).toHaveBeenCalledTimes(2)
  })
  it("enforces the hard limit while preserving unverified, uncollected signals as unknown", async () => {
    const limited = { ...signalConfig, maxAnswers: 1 }
    mocks.create.mockResolvedValue(reply("What else would you like to share?"))
    const result = await (await postConversation({ context, sessionId: "signals", message: "Hello.", previewTranscript: opening(limited), configuration: projectConversationConfiguration(limited) })).json()
    expect(result.status).toBe("completed")
    expect(result.signalEvidence.s_community.status).toBe("not_explored")
    expect(result.completion.complete).toBe(false)
  })
  it("uses identical evidence and model requests in preview and saved execution", async () => {
    const message = "I host an online group and welcome new members."
    mocks.create.mockResolvedValue(reply("Thanks for telling me about the group.", { close: true, signalEvidence: [evidenceUpdate(message)] }))
    const liveContext = { ...context, settings: normalizeProjectSettings(projectConversationSettings(signalConfig)) }
    mocks.history = opening(signalConfig)
    const live = await (await postDemoConversation({ context: liveContext, sessionId: "stored", message })).json()
    const liveRequests = mocks.create.mock.calls.map(call => call[0])
    const preview = await (await postConversation({ context: liveContext, sessionId: "preview", message, previewTranscript: opening(signalConfig), configuration: projectConversationConfiguration(signalConfig) })).json()
    const visible = { ...preview }; delete visible.previewTranscript
    expect(visible).toEqual(live)
    expect(mocks.create.mock.calls.slice(2).map(call => call[0])).toEqual(liveRequests)
    expect(preview.signalEvidence.s_community.sources).toEqual([{ quote: message, turn: 1 }])
    expect(mocks.writes.at(-1)?.metadata).toMatchObject({ conversation_signal_evidence: preview.signalEvidence })
    expect(mocks.queue).not.toHaveBeenCalled()
  })
})
