import Anthropic from "@anthropic-ai/sdk"
import type { ConversationMessage } from "@/lib/scoring"
import {
  DEFAULT_LOW_COST_ANTHROPIC_MODEL,
  logLlmUsage,
  modelFromEnv,
} from "@/lib/llm-usage"

/**
 * Profile v1 — versioned `core` extracted from every completed session,
 * plus optional `custom` fields validated against the persona's
 * declared JSON Schema.
 *
 * Reference: docs/profile-payload.schema.json
 */

export const PROFILE_SCHEMA_VERSION = 1 as const
const PROFILE_EXTRACTION_MODEL_ENV = "GROUCHO_PROFILE_EXTRACTION_MODEL"

export type Sentiment = "positive" | "neutral" | "negative"
export type Engagement = "high" | "medium" | "low"

export type ProfileQA = { question: string; answer: string }

export type ProfileCore = {
  summary: string
  sentiment: Sentiment
  engagement: Engagement
  language: string
  intent_tags: string[]
  interests: string[]
  risk_flags: string[]
  qa: ProfileQA[]
  confidence: number
}

export type ProfileExtractionMeta =
  | { model: string; status: "ok" }
  | { model: string; status: "failed"; reason: string }

export type Profile = {
  schema_version: typeof PROFILE_SCHEMA_VERSION
  core: ProfileCore | null
  custom: Record<string, unknown> | null
  extraction: ProfileExtractionMeta
}

export type PersonaForExtraction = {
  profile_schema: unknown
  profile_extractor_hint: string | null
}

const SENTIMENTS: Sentiment[] = ["positive", "neutral", "negative"]
const ENGAGEMENTS: Engagement[] = ["high", "medium", "low"]

const PROFILE_CORE_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    sentiment: { type: "string", enum: SENTIMENTS },
    engagement: { type: "string", enum: ENGAGEMENTS },
    language: { type: "string" },
    intent_tags: { type: "array", items: { type: "string" } },
    interests: { type: "array", items: { type: "string" } },
    risk_flags: { type: "array", items: { type: "string" } },
    qa: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
        },
        required: ["question", "answer"],
      },
    },
    confidence: { type: "number" },
  },
  required: [
    "summary",
    "sentiment",
    "engagement",
    "language",
    "intent_tags",
    "interests",
    "risk_flags",
    "qa",
    "confidence",
  ],
} as const

function structuredCustomProperty(raw: unknown, depth = 0): Record<string, unknown> {
  const value =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  const type = typeof value.type === "string" ? value.type : "string"
  const description =
    typeof value.description === "string"
      ? { description: value.description.slice(0, 240) }
      : {}
  if (type === "boolean" || type === "number" || type === "integer") {
    return { type, ...description }
  }
  if (type === "array") {
    return {
      type: "array",
      items: structuredCustomProperty(value.items, depth + 1),
      ...description,
    }
  }
  if (type === "object" && depth < 2) {
    const rawProperties =
      value.properties &&
      typeof value.properties === "object" &&
      !Array.isArray(value.properties)
        ? (value.properties as Record<string, unknown>)
        : {}
    const properties = Object.fromEntries(
      Object.entries(rawProperties).map(([key, definition]) => [
        key,
        structuredCustomProperty(definition, depth + 1),
      ]),
    )
    const required = Array.isArray(value.required)
      ? value.required.filter(
          (key): key is string =>
            typeof key === "string" && Object.hasOwn(properties, key),
        )
      : []
    return {
      type: "object",
      additionalProperties: false,
      properties,
      ...(required.length ? { required } : {}),
      ...description,
    }
  }
  return { type: "string", ...description }
}

function profileOutputSchema(personaSchema: unknown): Record<string, unknown> {
  const schema =
    personaSchema && typeof personaSchema === "object" && !Array.isArray(personaSchema)
      ? (personaSchema as Record<string, unknown>)
      : null
  const rawProperties =
    schema?.properties &&
    typeof schema.properties === "object" &&
    !Array.isArray(schema.properties)
      ? (schema.properties as Record<string, unknown>)
      : null
  const customProperties = rawProperties
    ? Object.fromEntries(
        Object.entries(rawProperties).map(([key, definition]) => [
          key,
          structuredCustomProperty(definition),
        ]),
      )
    : null
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      core: PROFILE_CORE_OUTPUT_SCHEMA,
      ...(customProperties
        ? {
            custom: {
              type: "object",
              additionalProperties: false,
              properties: customProperties,
            },
          }
        : {}),
    },
    required: ["core"],
  }
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/gi
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g

export function redactPiiInText(s: string): string {
  if (!s) return s
  return s.replace(EMAIL_RE, "[redacted-email]").replace(PHONE_RE, "[redacted-phone]")
}

function clamp01(n: unknown): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}

function asString(x: unknown, max = 280): string {
  if (typeof x !== "string") return ""
  return x.slice(0, max)
}

function asStringArray(x: unknown, maxLen: number): string[] {
  if (!Array.isArray(x)) return []
  return x
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .slice(0, maxLen)
    .map((v) => v.trim())
}

function asEnum<T extends string>(x: unknown, allowed: readonly T[], fallback: T): T {
  return typeof x === "string" && (allowed as readonly string[]).includes(x) ? (x as T) : fallback
}

function asQa(x: unknown): ProfileQA[] {
  if (!Array.isArray(x)) return []
  const out: ProfileQA[] = []
  for (const item of x) {
    if (!item || typeof item !== "object") continue
    const q = (item as { question?: unknown }).question
    const a = (item as { answer?: unknown }).answer
    if (typeof q === "string" && typeof a === "string") {
      out.push({
        question: redactPiiInText(q.slice(0, 280)),
        answer: redactPiiInText(a.slice(0, 1024)),
      })
    }
  }
  return out
}

function normaliseCore(raw: unknown): ProfileCore {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  return {
    summary: redactPiiInText(asString(r.summary, 280)),
    sentiment: asEnum(r.sentiment, SENTIMENTS, "neutral"),
    engagement: asEnum(r.engagement, ENGAGEMENTS, "medium"),
    language: asString(r.language, 16) || "en",
    intent_tags: asStringArray(r.intent_tags, 5),
    interests: asStringArray(r.interests, 10),
    risk_flags: asStringArray(r.risk_flags, 10),
    qa: asQa(r.qa),
    confidence: clamp01(r.confidence),
  }
}

/** Strip values whose keys aren't declared in `profile_schema.properties`. */
function dropUnknownCustomKeys(
  raw: unknown,
  personaSchema: unknown,
): Record<string, unknown> | null {
  if (!personaSchema || typeof personaSchema !== "object") return null
  const props = (personaSchema as { properties?: unknown }).properties
  if (!props || typeof props !== "object") return null
  const known = new Set(Object.keys(props as Record<string, unknown>))
  if (known.size === 0) return null

  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of known) {
    if (k in obj) out[k] = obj[k]
  }
  return out
}

function describeCustomFields(personaSchema: unknown): string {
  if (!personaSchema || typeof personaSchema !== "object") return ""
  const props = (personaSchema as { properties?: unknown }).properties
  if (!props || typeof props !== "object") return ""
  const entries = Object.entries(props as Record<string, unknown>)
  if (entries.length === 0) return ""

  const lines = entries.map(([key, schema]) => {
    const s = (schema && typeof schema === "object" ? schema : {}) as Record<string, unknown>
    const type = typeof s.type === "string" ? s.type : "string"
    const desc = typeof s.description === "string" ? s.description : ""
    return `- "${key}" (${type}): ${desc}`
  })
  return `\n\nAlso extract these brand-defined fields under the top-level "custom" object. If a field can't be inferred, omit it. Do not invent fields not listed.\n${lines.join("\n")}`
}

const CORE_INSTRUCTIONS = `You are a profile extractor. Given the full transcript of a short qualification conversation, produce a JSON object capturing the applicant's profile.

Return ONLY a JSON object. No commentary, no markdown fences.

Top-level keys:
- "core" object with:
  - "summary": <=280 chars, human-readable 1–2 sentences
  - "sentiment": one of "positive" | "neutral" | "negative"
  - "engagement": one of "high" | "medium" | "low"
  - "language": BCP-47 code (e.g. "en", "fr")
  - "intent_tags": short string array (<=5)
  - "interests": short string array (<=10)
  - "risk_flags": string array (e.g. ["bot_like","hostile","off_topic"]) — empty if none
  - "qa": array of {"question": string, "answer": string} pairs reconstructed from the transcript
  - "confidence": number 0..1 indicating overall extraction confidence
- Optionally a "custom" object with brand-defined fields (see below).

If you cannot determine a value, use a conservative default ("neutral", "medium", [], "en"), and set confidence accordingly.`

function transcriptToUserMessage(transcript: ConversationMessage[]): string {
  const lines = transcript.map((m) => {
    const role = m.role === "assistant" ? "ASSISTANT" : "USER"
    return `${role}: ${m.content}`
  })
  return `Conversation transcript:\n\n${lines.join("\n")}`
}

let client: Anthropic | null = null
function getClient(): Anthropic {
  if (!client) client = new Anthropic()
  return client
}

export type ExtractProfileOpts = {
  transcript: ConversationMessage[]
  persona: PersonaForExtraction | null
  requestId?: string
  organisationId?: string
  projectId?: string
  sessionId?: string
  terminalStatus?: string
}

export async function extractProfile(opts: ExtractProfileOpts): Promise<Profile> {
  const persona = opts.persona
  const personaSchema = persona?.profile_schema ?? null
  const hint = persona?.profile_extractor_hint?.trim()

  const system =
    CORE_INSTRUCTIONS +
    describeCustomFields(personaSchema) +
    (hint ? `\n\nAdditional brand hint: ${hint}` : "")
  const model = modelFromEnv(
    PROFILE_EXTRACTION_MODEL_ENV,
    DEFAULT_LOW_COST_ANTHROPIC_MODEL,
  )

  try {
    const response = await getClient().messages.create({
      model,
      max_tokens: 2048,
      system,
      output_config: {
        format: {
          type: "json_schema",
          schema: profileOutputSchema(personaSchema),
        },
      },
      messages: [
        {
          role: "user",
          content: transcriptToUserMessage(opts.transcript),
        },
      ],
    })
    logLlmUsage({
      operation: "profile_extraction",
      provider: "anthropic",
      model,
      usage: response.usage,
      requestId: opts.requestId,
      organisationId: opts.organisationId,
      projectId: opts.projectId,
      sessionId: opts.sessionId,
      terminalStatus: opts.terminalStatus,
    })

    const textBlock = response.content.find((b) => b.type === "text")
    if (response.stop_reason === "max_tokens") {
      return failed("max_tokens", model)
    }
    if (response.stop_reason === "refusal") {
      return failed("refusal", model)
    }
    if (!textBlock || textBlock.type !== "text") {
      return failed("no_text_block")
    }

    let raw: unknown
    try {
      raw = JSON.parse(textBlock.text)
    } catch {
      return failed("invalid_json")
    }

    if (!raw || typeof raw !== "object") return failed("non_object_response")

    const r = raw as Record<string, unknown>
    const core = normaliseCore(r.core)
    const custom = dropUnknownCustomKeys(r.custom, personaSchema)

    return {
      schema_version: PROFILE_SCHEMA_VERSION,
      core,
      custom,
      extraction: { model, status: "ok" },
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    return failed(reason.slice(0, 200), model)
  }
}

function failed(reason: string, model = modelFromEnv(PROFILE_EXTRACTION_MODEL_ENV)): Profile {
  return {
    schema_version: PROFILE_SCHEMA_VERSION,
    core: null,
    custom: null,
    extraction: { model, status: "failed", reason },
  }
}

/** Returns true if the property in `profile_schema.properties[key]` has `"x-pii": true`. */
export function isPiiField(personaSchema: unknown, key: string): boolean {
  if (!personaSchema || typeof personaSchema !== "object") return false
  const props = (personaSchema as { properties?: unknown }).properties
  if (!props || typeof props !== "object") return false
  const def = (props as Record<string, unknown>)[key]
  if (!def || typeof def !== "object") return false
  return (def as Record<string, unknown>)["x-pii"] === true
}

/** Compact summary for structured logs (never includes values). */
export function summariseProfileForLog(profile: Profile | null | undefined): {
  has_core: boolean
  custom_keys: string[]
  extraction_status: "ok" | "failed" | "none"
} {
  if (!profile) {
    return { has_core: false, custom_keys: [], extraction_status: "none" }
  }
  return {
    has_core: profile.core !== null,
    custom_keys: profile.custom ? Object.keys(profile.custom) : [],
    extraction_status: profile.extraction.status,
  }
}
