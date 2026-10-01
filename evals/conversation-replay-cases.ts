import { applicationSignalDefinitions, type ApplicationSignalMessage } from "@/lib/application-signal-state"

export const EXPERIENCE = {
  opening_message: "Why do you want to be an early applicant for the Forum?",
  closing_message: "It was good getting to understand you better.",
  max_turns: 9,
  required_signals: ["What brought you here?", "Name an artist more people should know about", "What was the last song you recommended and why?", "Which sounds most like you?", "Someone shares unfinished music. How do you respond?", "What could you contribute in your first month?"],
}
export const DEFINITIONS = applicationSignalDefinitions(EXPERIENCE.required_signals)
export const PERSONA = "You are Groucho, the attentive host at the COLORS Forum door. Be concise, curious and selectively warm. Receive a specific detail and ask one natural question. Judge substance, never status or polished language. Do not invent facts or reveal private outcomes. Follow the configured application policy."
export const ARMS = ["control", "short_instructions", "short_contract"] as const
export type Arm = typeof ARMS[number]
const key = (fragment: string) => DEFINITIONS.find((signal) => signal.label.toLowerCase().includes(fragment))!.key
export const KEYS = { motivation: key("what brought"), colors: key("relationship to colors"), artist: key("artist more"), song: key("last song"), participation: key("which sounds"), care: key("unfinished music"), contribution: key("first month") }

export type ReplayCase = {
  id: string; question: string; answer: string; goal: string;
  expectedCoverage: string[]; expectedRelation: string[];
  expectedActive: boolean; history?: ApplicationSignalMessage[];
  memoryMarker?: string;
}
const base = (id: string, question: string, answer: string, goal: string, expectedCoverage: string[], expectedRelation = ["direct"]): ReplayCase => ({ id, question, answer, goal, expectedCoverage, expectedRelation, expectedActive: true })
const prior = (text: string): ApplicationSignalMessage => ({ id: "prior_evidence", role: "user", content: text, metadata: { application_signal: { key: KEYS.contribution }, application_signals: [{ key: KEYS.contribution }] } })
const memoryIntro = "I initially planned to host a monthly listening night. "
const filler = "The room, timing, equipment and invitations were still only provisional and nothing had been arranged. ".repeat(9)
const correction = "Correction: I cannot host that night. My actual plan is a Sunday access-notes digest, summarising useful threads for members who missed them."
export const REPLAY_CASES: ReplayCase[] = [
  base("community-opening", EXPERIENCE.opening_message, "Community.", KEYS.motivation, [KEYS.motivation], ["direct", "partial"]),
  base("specific-colors", "Why COLORS specifically?", "The spare COLORS setting makes me hear small choices in the voice. I want the Forum to extend that patient attention into conversation.", KEYS.colors, [KEYS.colors]),
  base("artist-context", "Who deserves more attention, and what do you hear in their work?", "Tirzah. The awkward space around her vocal makes the emotion feel unfinished in a way I recognise.", KEYS.artist, [KEYS.artist]),
  base("multi-goal", "How do you take part around music?", "I host a listening circle every month and write notes on what changed after a second listen. I could keep that monthly rhythm in the Forum.", KEYS.participation, [KEYS.participation, KEYS.contribution]),
  base("vague-contribution", "What could you contribute here in your first month?", "Good vibes, I guess. I have no specific idea yet.", KEYS.contribution, []),
  base("subject-shift", "How do you respond to someone's unfinished work?", "The album Vespertine makes tiny noises feel as intimate as whispers in my room.", KEYS.care, [KEYS.artist], ["subject_shift", "ambiguous"]),
  base("consent-boundary", "What would you do with a private unfinished demo?", "I post a clip without asking. I would keep it up even if the artist objected because the exposure helps.", KEYS.care, [KEYS.care]),
  base("brief-unpolished", "What could you realistically contribute here?", "i could host a listening thread once a month. no industry contacts just time to listen and reply.", KEYS.contribution, [KEYS.contribution]),
  base("long-current", "What could you realistically contribute here?", filler + "I could host a monthly listening group here and document what changed on a second listen.", KEYS.contribution, [KEYS.contribution]),
  { ...base("memory-short", "What would you want other members to get from that plan?", "A way to catch up without having to read every thread. Can you remind me what I said I would put together?", KEYS.contribution, []), history: [prior(memoryIntro + correction)], memoryMarker: "Sunday access-notes digest" },
  { ...base("memory-long", "What would you want other members to get from that plan?", "A way to catch up without having to read every thread. Can you remind me what I said I would put together?", KEYS.contribution, []), history: [prior(memoryIntro + filler + correction)], memoryMarker: "Sunday access-notes digest" },
  { ...base("memory-followup-correction", "What would you want other members to get from that plan?", "A way to catch up without having to read every thread. Can you remind me what I said I would put together?", KEYS.contribution, []), history: [prior(memoryIntro + filler), { ...prior(correction), id: "correction" }], memoryMarker: "Sunday access-notes digest" },
].map((fixture) => fixture.goal === KEYS.care ? {
  ...fixture,
  history: [{ id: "feedback_context", role: "user" as const, content: "I exchange demos and give feedback on unfinished music.", metadata: { application_signal: { key: KEYS.participation }, application_signals: [{ key: KEYS.participation }] } }],
} : fixture)

export const SHORT_GUIDANCE = `Use the compact JSON state to continue this COLORS Forum conversation. Return the required groucho_respond tool.
Respond to a concrete detail in the current answer, then at most one natural question. No generic praise, invented connections, process announcements, or stacked questions. Do not repeat a covered goal merely to complete a checklist. Quiet participation is valid; never reward status, polish, fluency or famous references.
Assess answer quality separately from relation. Mark all goals explicitly supported by the current answer. Thin means genuinely vague or empty. For subject shifts or ambiguous connections, receive the detail neutrally, ask one disambiguating question, and leave nextSignalKey empty. For a useful partial answer, clarify the missing part without discarding its evidence.
Use clarify for thin answers, open_door after repeated thin answers if unused, rabbit_hole for one useful depth question, advance for a naturally connected unresolved goal, challenge for an explicit integrity concern, and decide only when ready to conclude. Respect per-goal follow-up limits and questionBudget. Current practice and future intent are different evidence; preserve corrections and never turn intention into past achievement.
Follow the opening motivation. Community alone invites what community means; maker disclosures invite practice; organising invites concrete roles. Establish COLORS relevance naturally. Artist or album references can lead to one song and why, never who received it. A fresh maker disclosure outranks that supporting song route. Feedback is relevant only when the applicant's own words establish it; orientation labels never require extra goals. Goals are evidence intents, not compulsory questions.
Prefer a grounded question using the applicant's concrete wording. Use nextSignalKey for that question's actual goal, or empty when none. Ask no further question at emergency_stop. Earlier closing must respect substantive evidence, unresolved concerns, and the live thread. Use only the configured neutral closing message; never reveal acceptance, rejection, scores or private evaluation. The runtime retains final policy authority.
Keep private reasons short, use supported evidenceFlags, and return valid scores. No reviewer report, thread bookkeeping, orientation, or UI fields are required.`
