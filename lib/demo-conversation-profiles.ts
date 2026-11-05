import { NextResponse } from "next/server"
import { postConversation, type ConversationChoice, type ConversationField, type ConversationConfiguration } from "@/lib/conversation-engine"
import { colorsThinConversationModel } from "@/lib/gatekeeper-models"
import { resolveActiveGatekeeperPersona } from "@/lib/persona-resolution"
import type { ProjectContext } from "@/lib/project-resolution"
import { LEWISHAM_SOCIAL_CONVERSATION_GUIDANCE, LEWISHAM_SOCIAL_OPENING } from "@/lib/lewisham-social-persona"
import { TOUR_NIGHTS, TOUR_CITIES, SEE_OTHER_CITIES, resolveLewishamChoice } from "@/lib/lewisham-social-tour"
import { formatMoReply } from "@/lib/lewisham-social-voice"
export { TOUR_NIGHTS } from "@/lib/lewisham-social-tour"

export const CONVERSATION_ENGINE_MARKER = "groucho_conversation_v1"
export const CONVERSATION_ENGINE_SETTING = "conversation_v1"
export type DemoConversationId = "loptimiste" | "saltings" | "lewisham-social"
type DemoProfile = {
  id: DemoConversationId
  opening: string
  openingChoice?: string
  objective: string
  guidance: string
  closing: string
  completion: string
  fields: readonly ConversationField[]
  choices: Readonly<Record<string, ConversationChoice>>
  typicalAnswers?: string
  wrapUpAnswers?: number
  softCloseAnswers?: number
  resolveChoice?: ConversationConfiguration["resolveChoice"]
  formatReply?: ConversationConfiguration["formatReply"]
  replyGuidance?: string
}

export const DEMO_CONVERSATION_PROFILES: Record<DemoConversationId, DemoProfile> = {
  loptimiste: {
    id: "loptimiste", opening: "Bonsoir. Is this for you, or for someone?", openingChoice: "recipient",
    objective: "Learn who the candle is for, one personal scent memory, and where it would burn.",
    guidance: "Follow the guest's memory with attention, then learn where the candle would burn. A gift is welcome: keep the recipient in mind without requiring the guest to know their private memories. A floral or coastal memory is not a failure and does not establish that they dislike smoke. Ask about scent preference only if needed. Do not invent geography, product names, a permanent collection, stock levels or a numbered reservation. The only supplied scent is cinza de inverno: woodsmoke, cold air and bourbon. Never pretend number 214 is allocated to anyone.",
    closing: "Merci for spending a little time with me.",
    completion: "Demo complete. No candle has been reserved and no access code will be sent.",
    fields: [
      { key: "recipient", label: "Who it is for", required: true },
      { key: "scentMemory", label: "A personal scent memory", required: true },
      { key: "burnLocation", label: "Where the candle would burn", required: true },
      { key: "ritual", label: "How it would be used" },
    ],
    choices: {
      recipient: { field: "recipient", question: "Is this for you, or for someone?", options: ["For me", "A gift"] },
      ritual: { field: "ritual", question: "Which sounds most like you?", options: ["A candle for long evenings", "A candle for one particular room", "A candle I’ll keep for an occasion", "I’d like to give it away"] },
    },
  },
  saltings: {
    id: "saltings", opening: "What are you working on, in a sentence you'd say out loud?",
    objective: "Understand the writing, where it is stuck, what two weeks would offer, a line of their own and their availability.",
    guidance: "The illustrative residency is 11–25 January 2027, a room of twelve. Hear the writing without grading it. Ask at most one useful follow-up on a difficulty. A line can be unfinished or one they cannot get right. Ask what the fortnight would offer with the need choice; ask availability with the attendance choice. Do not close before asking about a line and availability unless the writer wants to stop. If they cannot attend or do not wish to share a line, record that honestly and close without judgment. Do not invent workshops, letters, selection results, a shortlist or a place. The note is only a summary of what the writer actually said.",
    closing: "Thank you. Your note is here to read.",
    completion: "Demo complete. This note has not been sent and no residency application has been submitted.",
    fields: [
      { key: "workingOn", label: "Working on", required: true },
      { key: "stuck", label: "Where it is stuck", required: true },
      { key: "wants", label: "Wants from two weeks", required: true },
      { key: "line", label: "A line, or their decision not to share one", required: true },
      { key: "attendance", label: "Availability for 11–25 January", required: true },
    ],
    choices: {
      need: { field: "wants", question: "What do you need from two weeks?", options: ["Silence", "Company", "Someone to read it", "A deadline"] },
      attendance: { field: "attendance", question: "Can you be there for the full fortnight, 11 to 25 January?", options: ["Yes, the whole fortnight", "Most of it", "Not this time"] },
    },
  },
  "lewisham-social": {
    id: "lewisham-social", opening: LEWISHAM_SOCIAL_OPENING, openingChoice: "discovery",
    objective: "Understand how they found Lewisham Social, what connects them to the band and why, what else they enjoy, and their companion, travel origin and exact preferred tour night.",
    guidance: LEWISHAM_SOCIAL_CONVERSATION_GUIDANCE,
    typicalAnswers: "6–8", wrapUpAnswers: 9, softCloseAnswers: 11, resolveChoice: resolveLewishamChoice, formatReply: formatMoReply,
    replyGuidance: "MO'S NEXT QUESTION: Follow the visitor's most recent answer. If they change subject or offer another artist instead of answering your last question, follow their new topic; never insist on your unanswered question. An unfamiliar artist is an invitation to ask what they sound like, not to doubt the visitor or say you will take their word for it. When a fan has just revealed an unexpected gig event, ask about its reaction, recovery or consequence before a second topic mentioned in that same answer. Inviting the story earlier does not replace this one follow-up after the event is revealed. Reflecting the event then asking about the second topic does not follow the event. Once they describe the outcome, that story is resolved: move on, without asking for a song title or another retrospective question. For example, a performance falters, the crowd takes over, you ask what the performers did, and their account of the recovery completes that thread. Do not echo their story as a preamble. Prefer a single short question; do not combine identification and interpretation. Do not grade a song choice or announce that you love hearing stories. Let specific attention show Mo's personality. Answer direct questions and honour stopping and runtime limits.",
    closing: "Thanks for coming through the door.",
    completion: "Demo complete. Your preferred night is shown here; no tickets are reserved and no presale code will be sent.",
    fields: [
      { key: "discovery", label: "How they found the band", required: true },
      { key: "connection", label: "What connects them to the band and why, or being new / unsure / declining", required: true },
      { key: "otherInterests", label: "Other music, shows or interests in their own words, or uncertainty / declining", required: true },
      { key: "companion", label: "Who they would bring, or coming alone", required: true },
      { key: "location", label: "Where they are coming from", required: true },
      { key: "preferredCity", label: "Explicit preferred show city, separate from travel origin", values: TOUR_CITIES },
      { key: "night", label: "Exact preferred tour night", required: true, values: TOUR_NIGHTS },
    ],
    choices: {
      discovery: { field: "discovery", question: LEWISHAM_SOCIAL_OPENING, options: ["A gig", "A track", "Someone brought me along", "I've only just found you"] },
      night: { field: "night", question: "Which night would you prefer?", options: TOUR_NIGHTS, navigationOptions: [SEE_OTHER_CITIES],
        factsByOption: Object.fromEntries(TOUR_NIGHTS.map(night => [night, { preferredCity: night.split(",")[0] }])) },
    },
  },
}

export function demoConversationProfile(raw: unknown): DemoProfile | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const settings = raw as Record<string, unknown>
  if (settings.conversation_engine !== CONVERSATION_ENGINE_SETTING) return null
  const id = settings.conversation_profile
  return typeof id === "string" && Object.hasOwn(DEMO_CONVERSATION_PROFILES, id)
    ? DEMO_CONVERSATION_PROFILES[id as DemoConversationId] : null
}

export function usesReusableConversationEngine(raw: unknown): boolean {
  return Boolean(raw) && typeof raw === "object" && !Array.isArray(raw) &&
    (raw as Record<string, unknown>).conversation_engine === CONVERSATION_ENGINE_SETTING
}

/** Keep the configured character and tone, replacing legacy scripted outcomes with this runtime's contract. */
export function demoConversationPrompt(profile: DemoProfile, persona: string, turnCount: number): string {
  const character = persona.replace(/\\n/g, "\n").split(/\n\s*(?:CONVERSATION FLOW|DECISION GUIDANCE)/)[0]
  return `${character}

PROJECT CONVERSATION
Purpose: ${profile.objective}
${profile.guidance}
This is a fictional public demonstration, not a real allocation or application. Preserve the character above but replace any contradictory promise or decision instruction with this contract. Do not score, judge eligibility or promise a reservation, shortlist, ticket, code or email.
Respond to a concrete detail, then leave exactly one answerable question on every active turn. An observation alone is not a question. If asking an approved selection question, set choiceKey; the server supplies its options. Never ask a multiple-choice question without a supported choiceKey. Otherwise ask an open question and set choiceKey to none. Keep replies to two short sentences. Do not praise an answer as perfect or rank the person. Do not repeat details already supplied. Answer the person's questions directly, acknowledge corrections and respect requests to stop.
The conversation has ${turnCount} applicant answers. Aim for a short natural exchange, usually ${profile.typicalAnswers ?? "3–6"} answers, allowing extra turns only for useful clarification or missing required details. Completion requires the supplied required fields, or an honest incomplete close if they stop or the runtime reaches its limit. Never invent missing facts. On close, use a brief specific acknowledgement without a question; the runtime adds the character's final line and an honest demo completion message.
Call groucho_converse exactly once. Set close only when finished. Set addsNewContext honestly. Set boundary to none unless a concrete safety or privacy concern requires a response. Public music discussion is ordinary conversation, not a consent test. Never reveal internal field keys, scoring, budgets or routing.`
}

export async function postDemoConversation(input: Omit<Parameters<typeof postConversation>[0], "configuration"> & { context: ProjectContext }) {
  const profile = demoConversationProfile(input.context.settings.raw)
  const personaId = input.context.settings.raw.persona_id
  if (!profile || typeof personaId !== "string") return NextResponse.json({ error: "Demo conversation is not configured" }, { status: 503 })
  const persona = await resolveActiveGatekeeperPersona([personaId], input.context.organisationId)
  if (!persona || persona.id !== personaId) return NextResponse.json({ error: "Demo persona unavailable" }, { status: 503 })
  return postConversation({ ...input, runCompletion: false, configuration: {
    id: profile.id, marker: CONVERSATION_ENGINE_MARKER, model: colorsThinConversationModel(),
    fields: profile.fields, choices: profile.choices, resolveChoice: profile.resolveChoice, formatReply: profile.formatReply, replyGuidance: profile.replyGuidance,
    wrapUpAnswers: profile.wrapUpAnswers ?? 7, softCloseAnswers: profile.softCloseAnswers ?? 10,
    closingMessage: profile.closing, completionMessage: profile.completion,
    consentStatement: "Someone else's private information needs their permission before it is shared.",
    consentQuestion: "Would you ask for their permission before sharing it?",
    buildPrompt: ({ turnCount }) => demoConversationPrompt(profile, persona.prompt, turnCount),
  } })
}
