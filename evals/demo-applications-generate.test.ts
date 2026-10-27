/* eslint-disable @typescript-eslint/no-explicit-any -- The in-memory database and captured provider payloads deliberately retain heterogeneous runtime shapes. */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"
import { COLORS_FORUM_PERSONA_PROMPT } from "@/lib/colors-forum-persona"
import { normalizeProjectSettings } from "@/lib/project-settings"
import { colorsForumV1SignalDefinitions } from "@/lib/application-signal-state"

type Row = Record<string, any>
const harness = vi.hoisted(() => ({ tables: { sessions: [] as Row[], messages: [] as Row[], personas: [] as Row[] }, settings: null as any, calls: [] as Row[], sequence: 0 }))
// Real handlers and models, with every persistent write/notification replaced.
vi.mock("@/lib/supabase", () => ({ supabase: { from(table: string) {
  if (!(table in harness.tables)) throw new Error(`Unexpected table: ${table}`)
  const rows = harness.tables[table as keyof typeof harness.tables]
  const filters: Array<[string, unknown]> = []
  let update: Row | null = null
  let inserted: Row[] | null = null
  const execute = () => {
    const matching = rows.filter(row => filters.every(([k,v]) => row[k] === v))
    if (update) matching.forEach(row => Object.assign(row, update))
    return { data: inserted ?? matching, error: null }
  }
  const chain = {
    select: () => chain, order: () => chain, limit: () => chain,
    eq: (k:string,v:unknown) => { filters.push([k,v]); return chain },
    is: (k:string,v:unknown) => { filters.push([k,v]); return chain },
    update: (value:Row) => { update=value; return chain },
    insert: (value:Row | Row[]) => { inserted=(Array.isArray(value)?value:[value]).map(row=>({id:`synthetic-${++harness.sequence}`, ...(table === "sessions" ? { status: "active" } : {}), ...row})); rows.push(...inserted); return chain },
    maybeSingle: async () => ({ data: execute().data[0] ?? null, error:null }),
    single: async () => ({ data: execute().data[0] ?? null, error:null }),
    then: (resolve:(v:ReturnType<typeof execute>)=>unknown) => Promise.resolve(execute()).then(resolve),
  }
  return chain
} } }))
vi.mock("@/lib/project-resolution", () => ({ resolveProjectContext: async () => ({ok:true,context:{organisationId:"synthetic-org",projectId:"synthetic-project",apiKeyId:"synthetic-key",settings:harness.settings}}), touchApiKeyLastUsed: () => {} }))
vi.mock("@/lib/persona-resolution", () => ({ resolveActiveGatekeeperPersona: async () => ({id:"synthetic-persona",prompt:COLORS_FORUM_PERSONA_PROMPT,pass_threshold:0.65,reject_threshold:0.25}) }))
vi.mock("@/lib/session-completion-jobs", () => ({ enqueueSessionCompletionJob: async () => {}, completeSessionImmediately: async () => {}, scheduleSessionCompletionDrain: () => {}, queueSessionCompletion: async () => {} }))
vi.mock("@/lib/automatic-application-decision", () => ({ recordAutomaticApplicationDecision: async () => null }))
vi.mock("@/lib/colors-youtube-feed", async original => ({...await original<typeof import("@/lib/colors-youtube-feed")>(),fetchLatestColorsShows:async()=>[]}))
vi.mock("@/lib/logger", () => ({log:{info:()=>{},warn:()=>{},error:(...args:unknown[])=>process.stdout.write(`HANDLER_ERROR ${JSON.stringify(args)}\n`)}}))
vi.mock("@/lib/llm-usage", async original => ({...await original<typeof import("@/lib/llm-usage")>(),logLlmUsage:(usage: { operation: string })=>{ const call=harness.calls.at(-1); if(call) call.operation=usage.operation }}))
vi.mock("@anthropic-ai/sdk", async original => {
  const actual = await original<typeof import("@anthropic-ai/sdk")>()
  return { default: class { messages={create:async(request:any)=>{
    const start=Date.now()
    const response=await new actual.default({maxRetries:1,timeout:60000}).messages.create(request)
    harness.calls.push({model:response.model,ms:Date.now()-start,usage:response.usage,tool:request.tools?.[0]?.name ?? "structured_json",stopReason:response.stop_reason})
    return response
  },stream:(request:any)=>{
    const start=Date.now()
    const stream=new actual.default({maxRetries:1,timeout:60000}).messages.stream(request)
    void stream.finalMessage().then(response=>harness.calls.push({model:response.model,ms:Date.now()-start,usage:response.usage,tool:request.tools?.[0]?.name ?? "structured_json",stopReason:response.stop_reason,streamed:true})).catch(()=>{})
    return stream
  }} } }
})


// Generates the built-in sample project for the dashboard demo: varied fictional applicants run
// through the real conversation engine, integrity audit, reviewer report and profile extraction,
// with in-memory storage only. Opt-in and paid: GROUCHO_DEMO_APPLICATIONS_GENERATE=1.
const applicants = [
  { name: "Maya Okafor", city: "London", age: 29, audience: "community", brief: "You run a monthly listening night in a Peckham bar where people bring one record and explain why. You discovered COLORS through a Little Simz performance and now use the shows to find artists for the night. You want the Forum to swap finds with people outside your city. Answer in 1-3 warm, specific sentences.", first: "I host a monthly listening night where everyone brings one record and says why it matters to them. COLORS is where I find half of the artists we end up playing, and I'd love to swap finds with people outside London." },
  { name: "Theo Laurent", city: "Lyon", age: 34, audience: "artist", artistName: "Theo L", brief: "You are a jazz-trained pianist making instrumental electronic music, two EPs released on a small label. You want honest notes on arrangement from other producers and would give detailed feedback back. Calm, precise, 1-3 sentences.", first: "I make instrumental electronic music that leans on my jazz piano background, and I've put out two small EPs. I'm looking for producers who'll be honest about arrangement, and I'd return the favour properly." },
  { name: "Jordan Pike", city: "Manchester", age: 22, audience: "community", brief: "You only recently started watching COLORS, mostly on your commute, and don't make music. You are curious but quiet and unsure what you'd add. Short, honest answers of 4-15 words. Not negative, just new.", first: "I've just started watching COLORS on my commute and I'd like to learn more." },
  { name: "Rico Vance", city: "Los Angeles", age: 31, audience: "community", brief: "You run a music promotion page and mainly want to reach COLORS artists to sell them paid promotion packages. Be upfront about it when asked what you'd do in the Forum. 1-2 confident sentences.", first: "I run a promo page with 80k followers and I'm always looking for new artists to work with." },
  { name: "Amara Diallo", city: "Paris", age: 26, audience: "artist", artistName: "AMARA", brief: "You are a singer-songwriter mixing French and Wolof, one single out. You write with a small collective and want to hear how listeners outside Paris receive your lyrics. Warm, 1-3 sentences.", first: "I write songs in French and Wolof with a small collective in Paris, and I've released one single. I'd love to hear how people who don't speak either language feel the songs." },
  { name: "Sam Whitfield", city: "Bristol", age: 38, audience: "community", brief: "You are a photographer who shoots small gigs in Bristol and shares the photos with the bands for free. You love COLORS' visual style. You'd share gig photos and local show recommendations. 1-3 sentences.", first: "I photograph small gigs around Bristol and give the shots to the bands. COLORS' look has shaped how I light and frame things, and I'd like to share what's happening in our scene." },
  { name: "Kai Moreno", city: "Berlin", age: 24, audience: "artist", artistName: "kaimo", brief: "You make club tracks and, when asked, say you'd post other producers' unreleased demos you were sent privately because 'it gets people talking'. Keep that position if challenged. Casual, 1-2 sentences.", first: "I make club tracks and I'm always sharing stuff I get sent so people can hear what's coming." },
  { name: "Priya Nair", city: "Toronto", age: 30, audience: "community", brief: "You curate a weekly playlist for a community radio show and write short notes on each track. You are interested in TONES events and want to discuss scenes in different cities. 1-3 thoughtful sentences.", first: "I curate a weekly playlist for a community radio show and write a short note for every track. I'm interested in how scenes differ between cities, which is what drew me to TONES." },
  { name: "Ellis Grant", city: "Glasgow", age: 27, audience: "artist", artistName: "Ellis Grant", brief: "You are a folk guitarist who plays open-mic nights and has never released anything. You are a bit vague about what you want beyond 'getting better'. Answers of 5-15 words, friendly.", first: "I play guitar at open mics and I just want to get better really." },
  { name: "Lena Fischer", city: "Vienna", age: 41, audience: "community", brief: "You organise a small youth music workshop and want ideas and artists to show teenagers. You'd share workshop experiences and ask for recommendations. 1-3 sentences, practical.", first: "I run a weekly music workshop for teenagers and I'm always looking for artists and performances that open their ears. The Forum looks like a place to trade ideas with people who care about that." },
]

const generate = process.env.GROUCHO_DEMO_APPLICATIONS_GENERATE === "1"
describe.skipIf(!generate)("generate demo applications", () => {
  it("produces conversations, reports and profiles for the sample project", async () => {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY required")
    process.env.GROUCHO_RL_API_KEY_PER_MINUTE = "10000"
    process.env.GROUCHO_RL_SESSION_PER_MINUTE = "10000"
    const actual = await vi.importActual<typeof import("@anthropic-ai/sdk")>("@anthropic-ai/sdk")
    const applicantClient = new actual.default({ maxRetries: 1, timeout: 60000 })
    const { startGatekeeperSession } = await import("@/lib/start-gatekeeper-session")
    const { postColorsThinConversation, COLORS_THIN_PILOT_MARKER } = await import("@/lib/colors-thin-conversation")
    const { pendingColorsReport } = await import("@/lib/colors-post-conversation")
    const { generateColorsThinAssessment } = await import("@/lib/colors-thin-assessment")
    const { suitabilityFromReviewerReport } = await import("@/lib/colors-suitability")
    const output = process.env.GROUCHO_DEMO_APPLICATIONS_OUTPUT ?? "lib/demo-applications.fixture.json"
    // GROUCHO_DEMO_APPLICANT="Name" regenerates one applicant and keeps the rest of the file.
    const only = process.env.GROUCHO_DEMO_APPLICANT
    const results: Row[] = only && existsSync(output) ? JSON.parse(readFileSync(output, "utf8")).applications.filter((r: Row) => r.person.name !== only) : []
    for (const [index, person] of applicants.entries()) {
      if (only && person.name !== only) continue
      harness.tables = { sessions: [], messages: [], personas: [{ id: "synthetic-persona", is_active: true, is_default: true }] }
      harness.settings = normalizeProjectSettings({ project_type: "gatekeeper", application_experience: { opening_message: "Why do you want to be an early applicant for the Forum?", closing_message: "It was good getting to understand you better.", max_turns: 9, required_signals: colorsForumV1SignalDefinitions().map(s => s.label) } })
      const context = { organisationId: "synthetic-org", projectId: "synthetic-project", apiKeyId: "synthetic-key", settings: harness.settings }
      const details = { city: person.city, age: person.age, ...(person.artistName ? { artistName: person.artistName } : {}), socialLinks: [], musicLinks: [] }
      const email = `${person.name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`
      const applicant = { email, name: person.name, ...(person.audience === "artist" ? { artist: details } : { details }) }
      const sessionId = `demo-${index + 1}`
      try {
        let response = await startGatekeeperSession({ sessionId, applicantIdentity: applicant, context, projectSettings: harness.settings, conversationEngine: COLORS_THIN_PILOT_MARKER })
        let body = await response.json()
        for (let turn = 0; turn < 9 && body.status !== "completed"; turn++) {
          const answer = turn === 0 ? person.first : (await applicantClient.messages.create({ temperature: 0, model: "claude-haiku-4-5-20251001", max_tokens: 200, system: `Act only as a fictional applicant for a product demo. Stay within these facts. ${person.brief} Return only your next answer.`, messages: [{ role: "user", content: JSON.stringify(harness.tables.messages.map((m: Row) => ({ role: m.role, content: m.content }))) }] })).content.filter(b => b.type === "text").map(b => b.text).join("\n").trim()
          response = await postColorsThinConversation({ context, sessionId, message: answer, applicant })
          body = await response.json()
          if (response.status !== 200) throw new Error(`Turn returned ${response.status}`)
        }
        const rows = harness.tables.messages.map((m: Row) => ({ id: m.id, role: m.role, content: m.content, metadata: m.metadata }))
        const assessed = await generateColorsThinAssessment({ rows, baseReport: pendingColorsReport(rows), terminalStatus: "completed", organisationId: "synthetic-org", projectId: "synthetic-project", sessionKey: sessionId })
        results.push({ index, person: { name: person.name, city: person.city, age: person.age, audience: person.audience, ...(person.artistName ? { artistName: person.artistName } : {}) }, email, applicant, sessionId, transcript: rows.filter((m: Row) => m.role === "user" || m.role === "assistant").map((m: Row) => ({ id: m.id, role: m.role, content: m.content })), report: assessed.report, profile: assessed.profile, suitabilityScore: suitabilityFromReviewerReport(assessed.report) })
        process.stdout.write(`DEMO_APPLICANT ${person.name} recommendation=${assessed.report.advisory_recommendation} confidence=${assessed.report.confidence_score}\n`)
      } catch (error) {
        process.stdout.write(`DEMO_APPLICANT_FAILED ${person.name} ${String(error)}\n`)
      }
      results.sort((a, b) => a.index - b.index)
      writeFileSync(output, JSON.stringify({ generated: new Date().toISOString(), note: "Fictional applicants for the dashboard sample project. Generated by evals/demo-applications-generate.test.ts.", applications: results }, null, 2) + "\n")
    }
    expect(results.length).toBeGreaterThan(0)
  }, 1800000)
})
