/** Client-safe, versioned contract shared by authoring, preview and the runtime. */
export type ProjectQuestionType = "text" | "singleSelect" | "multiSelect"
export type ProjectConversationQuestion = {
  id: string
  question: string
  type: ProjectQuestionType
  options: string[]
  required: boolean
}
export type LegacyProjectConversationConfig = {
  version: 1
  openingMessage: string
  openingQuestion: string
  maxAnswers: number
  intent: string
  persona: { name: string; instructions: string }
  questions: ProjectConversationQuestion[]
}
export type ProjectConversationSignal = {
  id: string
  name: string
  understanding: string
  evidence: string
  examples: string[]
  explore: boolean
  question: string
  answerType: "auto" | ProjectQuestionType
  options: string[]
}
export type SignalProjectConversationConfig = Omit<LegacyProjectConversationConfig, "version" | "questions"> & {
  version: 2
  projectContext?: string
  conversationGuidance?: string
  closingGuidance?: string
  closingMessage?: string
  /** Keep the existing COLORS private assessment and application delivery pipeline. */
  applicationReview?: "colors_forum"
  signals: ProjectConversationSignal[]
}
export const DEFAULT_PROJECT_CLOSING_MESSAGE = "Thank you for taking the time to chat."
export type ProjectConversationConfig = LegacyProjectConversationConfig | SignalProjectConversationConfig
export const DEFAULT_PROJECT_CONVERSATION: LegacyProjectConversationConfig = {
  version: 1,
  openingMessage: "Hello. Thanks for taking a little time to chat.",
  openingQuestion: "What brings you here?",
  maxAnswers: 8,
  intent: "",
  persona: { name: "Host", instructions: "Be warm, curious and direct. Use plain English, notice concrete details, and give people room to be unsure." },
  questions: [],
}

type Result = { ok: true; config: ProjectConversationConfig } | { ok: false; error: string }
export function validateProjectConversation(value: unknown): Result {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "Conversation settings are required." }
  const o = { ...(value as Record<string, unknown>) }
  if (o.version === 2 && o.openingQuestion === undefined) o.openingQuestion = ""
  const validText = (v: unknown, max: number, required = true): v is string =>
    typeof v === "string" && (!required || !!v.trim()) && v.trim().length <= max
  if (o.version !== 1 && o.version !== 2) return { ok: false, error: "Unsupported conversation settings version." }
  if (!validText(o.openingMessage, 500, false)) return { ok: false, error: "Use up to 500 characters for the opening message." }
  if (!validText(o.openingQuestion, 500, o.version === 1)) return { ok: false, error: "Add an opening question of up to 500 characters." }
  if (!Number.isInteger(o.maxAnswers) || Number(o.maxAnswers) < 1 || Number(o.maxAnswers) > 12) return { ok: false, error: "Set the answer limit between 1 and 12." }
  if (!validText(o.intent, 2000)) return { ok: false, error: "Describe the conversation intent in up to 2,000 characters." }
  const persona = o.persona as Record<string, unknown> | null
  if (!persona || !validText(persona.name, 80) || !validText(persona.instructions, 6000)) return { ok: false, error: "Add a persona name (up to 80 characters) and instructions (up to 6,000 characters)." }
  if (o.version === 2) {
    if (o.applicationReview !== undefined && o.applicationReview !== "colors_forum") return { ok: false, error: "Unsupported application review pipeline." }
    const projectControls: Pick<SignalProjectConversationConfig, "projectContext" | "conversationGuidance" | "closingGuidance" | "closingMessage"> = {}
    for (const [key, label, limit] of [
      ["projectContext", "project context", 6000],
      ["conversationGuidance", "conversation guidance", 3000],
      ["closingGuidance", "closing guidance", 2000],
      ["closingMessage", "closing message", 500],
    ] as const) {
      // Leave omitted controls absent so existing configurations retain their revision.
      if (o[key] === undefined) continue
      if (!validText(o[key], limit, false)) return { ok: false, error: `Use up to ${limit.toLocaleString("en-US")} characters for the ${label}.` }
      projectControls[key] = o[key].trim()
    }
    if (projectControls.closingMessage?.includes("?")) return { ok: false, error: "Use a statement for the closing message. Ask any final question in the conversation before closing." }
    if (!Array.isArray(o.signals) || o.signals.length > 12) return { ok: false, error: "Use up to 12 signals." }
    const signals: ProjectConversationSignal[] = []
    const ids = new Set<string>()
    for (const [index, raw] of o.signals.entries()) {
      const label = `Signal ${index + 1}`
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: `${label} is invalid.` }
      const signal: Record<string, unknown> = { evidence: "", examples: [], explore: true, question: "", answerType: "auto", options: [], ...raw }
      if (typeof signal.id !== "string" || !/^(?:s|q)_[a-z0-9_]{1,40}$/.test(signal.id) || ids.has(signal.id)) return { ok: false, error: `${label} needs a unique ID.` }
      ids.add(signal.id)
      if (!validText(signal.name, 100) || !validText(signal.understanding, 1000)) return { ok: false, error: `${label} needs a name (up to 100 characters) and what you want to understand (up to 1,000 characters).` }
      if (!validText(signal.evidence, 2000, false)) return { ok: false, error: `${label}: describe informative evidence in up to 2,000 characters.` }
      if (!Array.isArray(signal.examples) || signal.examples.length > 6 || signal.examples.some(v => !validText(v, 1000, false))) return { ok: false, error: `${label}: add up to six example answers of 1,000 characters each.` }
      if (typeof signal.explore !== "boolean" || !validText(signal.question, 500, false) || !["auto", "text", "singleSelect", "multiSelect"].includes(String(signal.answerType))) return { ok: false, error: `${label}: choose supported conversation controls.` }
      if (!Array.isArray(signal.options) || signal.options.some(v => !validText(v, 160, false))) return { ok: false, error: `${label} has invalid options.` }
      const choice = signal.answerType === "singleSelect" || signal.answerType === "multiSelect"
      const options = signal.options.map((v: string) => v.trim()).filter(Boolean)
      if (choice && (options.length < 2 || options.length > 12 || new Set(options).size !== options.length)) return { ok: false, error: `${label} needs 2–12 distinct options.` }
      signals.push({ id: signal.id, name: signal.name.trim(), understanding: signal.understanding.trim(), evidence: signal.evidence.trim(), examples: signal.examples.map((v: string) => v.trim()).filter(Boolean), explore: signal.explore, question: signal.question.trim(), answerType: signal.answerType as ProjectConversationSignal["answerType"], options: choice ? options : [] })
    }
    return { ok: true, config: { version: 2, openingMessage: o.openingMessage.trim(), openingQuestion: o.openingQuestion.trim(), maxAnswers: Number(o.maxAnswers), intent: o.intent.trim(), persona: { name: persona.name.trim(), instructions: persona.instructions.trim() }, ...projectControls, ...(o.applicationReview === "colors_forum" ? { applicationReview: "colors_forum" as const } : {}), signals } }
  }
  if (!Array.isArray(o.questions) || o.questions.length > 12) return { ok: false, error: "Use up to 12 questions." }
  const ids = new Set<string>()
  const questions: ProjectConversationQuestion[] = []
  for (const [index, raw] of o.questions.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: `Question ${index + 1} is invalid.` }
    const q = raw as Record<string, unknown>
    if (typeof q.id !== "string" || !/^q_[a-z0-9_]{1,40}$/.test(q.id) || ids.has(q.id)) return { ok: false, error: `Question ${index + 1} needs a unique ID.` }
    ids.add(q.id)
    if (!validText(q.question, 500)) return { ok: false, error: `Write question ${index + 1} in up to 500 characters.` }
    if (!["text", "singleSelect", "multiSelect"].includes(String(q.type))) return { ok: false, error: `Choose a supported type for question ${index + 1}.` }
    if (typeof q.required !== "boolean") return { ok: false, error: `Choose whether question ${index + 1} is required.` }
    if (!Array.isArray(q.options) || q.options.some(v => !validText(v, 160, false))) return { ok: false, error: `Question ${index + 1} has invalid options.` }
    const options = q.options.map((v: string) => v.trim()).filter(Boolean)
    if (q.type !== "text" && (options.length < 2 || options.length > 12 || new Set(options).size !== options.length)) return { ok: false, error: `Question ${index + 1} needs 2–12 distinct options.` }
    questions.push({ id: q.id, question: q.question.trim(), type: q.type as ProjectQuestionType, required: q.required, options: q.type === "text" ? [] : options })
  }
  return { ok: true, config: {
    version: 1, openingMessage: o.openingMessage.trim(), openingQuestion: o.openingQuestion.trim(), maxAnswers: Number(o.maxAnswers),
    intent: o.intent.trim(), persona: { name: persona.name.trim(), instructions: persona.instructions.trim() }, questions,
  } }
}
export function readProjectConversation(raw: unknown): ProjectConversationConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const s = raw as Record<string, unknown>
  if (s.conversation_engine !== "conversation_v1" || s.conversation_profile !== "project") return null
  const result = validateProjectConversation(s.project_conversation)
  return result.ok ? result.config : null
}
export function projectConversationOpening(config: ProjectConversationConfig) {
  return [config.openingMessage, projectOpeningQuestion(config)].filter(Boolean).join("\n\n")
}
export function projectConversationSettings(config: ProjectConversationConfig) {
  return {
    project_type: "gatekeeper", conversation_engine: "conversation_v1", conversation_profile: "project",
    project_conversation: config,
    // Application projects retain their legacy experience for conversations already in progress.
    ...(config.version === 2 && config.applicationReview ? {} : { application_experience: { opening_message: projectOpeningQuestion(config), max_turns: config.maxAnswers } }),
  }
}

export const DEFAULT_SIGNAL_CONVERSATION: SignalProjectConversationConfig = {
  version: 2, openingMessage: DEFAULT_PROJECT_CONVERSATION.openingMessage, openingQuestion: "",
  maxAnswers: 8, intent: "", persona: { ...DEFAULT_PROJECT_CONVERSATION.persona }, signals: [],
}
export function upgradeProjectConversation(config: ProjectConversationConfig): SignalProjectConversationConfig {
  if (config.version === 2) return config
  const { questions, ...base } = config
  return { ...base, version: 2, signals: questions.map(q => ({
    id: q.id, name: q.question.slice(0, 100), understanding: q.question,
    evidence: "The applicant’s own answer, including honest uncertainty or a decision not to share.",
    examples: [], explore: q.required, question: q.question, answerType: q.type, options: q.options,
  })) }
}
export function signalQuestion(signal: ProjectConversationSignal) {
  return signal.question || (signal.answerType === "singleSelect" || signal.answerType === "multiSelect"
    ? `For “${signal.name}”, which option fits you best?`
    : `What would you like to share about ${signal.name.toLowerCase()}?`)
}
export function projectOpeningQuestion(config: ProjectConversationConfig) {
  return config.openingQuestion || (config.version === 2 && config.signals[0] ? signalQuestion(config.signals[0]) : "What brings you here?")
}
