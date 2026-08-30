import { beforeEach, describe, expect, it, vi } from "vitest"

let anthropicCreateImpl: (args: unknown) => Promise<unknown> = async () => ({
  content: [{ type: "text", text: "{}" }],
})
let lastAnthropicArgs: Record<string, unknown> | null = null

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class Anthropic {
      messages = {
        create: (args: unknown) => {
          lastAnthropicArgs = args as Record<string, unknown>
          return anthropicCreateImpl(args)
        },
      }
    },
  }
})

import {
  extractProfile,
  redactPiiInText,
  isPiiField,
  summariseProfileForLog,
} from "@/lib/profile-extraction"

const transcript = [
  { role: "assistant" as const, content: "Why are you joining?" },
  { role: "user" as const, content: "I am Alex from Berlin. Email me at alex@example.com." },
]

describe("redactPiiInText", () => {
  it("masks emails and phone numbers", () => {
    const out = redactPiiInText("Email me at jane@example.com or call +44 7700 900123.")
    expect(out).not.toContain("jane@example.com")
    expect(out).not.toContain("+44 7700 900123")
    expect(out).toContain("[redacted-email]")
    expect(out).toContain("[redacted-phone]")
  })

  it("leaves clean strings untouched", () => {
    expect(redactPiiInText("Just a normal sentence.")).toBe("Just a normal sentence.")
  })
})

describe("extractProfile", () => {
  beforeEach(() => {
    lastAnthropicArgs = null
    anthropicCreateImpl = async () => ({
      content: [{ type: "text", text: "{}" }],
    })
  })

  it("returns custom = null when persona has no profile_schema", async () => {
    anthropicCreateImpl = async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            core: {
              summary: "Friendly Berlin attendee.",
              sentiment: "positive",
              engagement: "high",
              language: "en",
              intent_tags: ["club_entry"],
              interests: ["techno"],
              risk_flags: [],
              qa: [{ question: "Why?", answer: "Because." }],
              confidence: 0.8,
            },
            custom: { unexpected: "value" },
          }),
        },
      ],
    })

    const out = await extractProfile({ transcript, persona: null })
    expect(out.extraction.status).toBe("ok")
    expect(out.core?.summary).toBe("Friendly Berlin attendee.")
    expect(out.custom).toBeNull()
    expect(lastAnthropicArgs).toMatchObject({
      max_tokens: 2048,
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            required: ["core"],
            additionalProperties: false,
          },
        },
      },
    })
  })

  it("keeps declared custom fields, drops unknown LLM keys", async () => {
    anthropicCreateImpl = async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            core: {
              summary: "ok",
              sentiment: "neutral",
              engagement: "medium",
              language: "en",
              intent_tags: [],
              interests: [],
              risk_flags: [],
              qa: [],
              confidence: 0.5,
            },
            custom: {
              age_band: "25-34",
              referral: "friend",
              email_secret: "leak@me.com",
              made_up: "nope",
            },
          }),
        },
      ],
    })

    const persona = {
      profile_schema: {
        type: "object",
        properties: {
          age_band: { type: "string", description: "Age bucket" },
          referral: { type: "string" },
          email_secret: { type: "string", "x-pii": true },
        },
      },
      profile_extractor_hint: null,
    }

    const out = await extractProfile({ transcript, persona })
    expect(out.custom).toEqual({
      age_band: "25-34",
      referral: "friend",
      email_secret: "leak@me.com",
    })
    expect(lastAnthropicArgs).toMatchObject({
      output_config: {
        format: {
          schema: {
            properties: {
              custom: {
                additionalProperties: false,
                properties: {
                  age_band: { type: "string" },
                  referral: { type: "string" },
                  email_secret: { type: "string" },
                },
              },
            },
          },
        },
      },
    })
  })

  it("redacts emails in core.summary and core.qa[*].answer", async () => {
    anthropicCreateImpl = async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            core: {
              summary: "Contact alex@example.com for follow up.",
              sentiment: "positive",
              engagement: "high",
              language: "en",
              intent_tags: [],
              interests: [],
              risk_flags: [],
              qa: [
                {
                  question: "Email?",
                  answer: "alex@example.com",
                },
              ],
              confidence: 0.9,
            },
          }),
        },
      ],
    })

    const out = await extractProfile({ transcript, persona: null })
    expect(out.core?.summary).not.toContain("alex@example.com")
    expect(out.core?.summary).toContain("[redacted-email]")
    expect(out.core?.qa[0]?.answer).not.toContain("alex@example.com")
    expect(out.core?.qa[0]?.answer).toContain("[redacted-email]")
  })

  it("returns failed status when model returns invalid JSON", async () => {
    anthropicCreateImpl = async () => ({
      content: [{ type: "text", text: "not-json" }],
    })

    const out = await extractProfile({ transcript, persona: null })
    expect(out.extraction.status).toBe("failed")
    expect(out.core).toBeNull()
    expect(out.custom).toBeNull()
  })

  it("returns failed status when the model throws", async () => {
    anthropicCreateImpl = async () => {
      throw new Error("boom")
    }
    const out = await extractProfile({ transcript, persona: null })
    expect(out.extraction.status).toBe("failed")
    if (out.extraction.status === "failed") {
      expect(out.extraction.reason).toContain("boom")
    }
  })

  it("clamps invalid enum values to safe defaults", async () => {
    anthropicCreateImpl = async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            core: {
              summary: "ok",
              sentiment: "not-an-enum",
              engagement: "??",
              language: 123,
              intent_tags: "nope",
              interests: ["a", "", "b"],
              risk_flags: null,
              qa: [{ question: 1, answer: 2 }, { question: "ok", answer: "good" }],
              confidence: 5,
            },
          }),
        },
      ],
    })

    const out = await extractProfile({ transcript, persona: null })
    expect(out.core?.sentiment).toBe("neutral")
    expect(out.core?.engagement).toBe("medium")
    expect(out.core?.language).toBe("en")
    expect(out.core?.intent_tags).toEqual([])
    expect(out.core?.interests).toEqual(["a", "b"])
    expect(out.core?.risk_flags).toEqual([])
    expect(out.core?.qa.length).toBe(1)
    expect(out.core?.confidence).toBe(1)
  })
})

describe("isPiiField", () => {
  const schema = {
    type: "object",
    properties: {
      email: { type: "string", "x-pii": true },
      age_band: { type: "string" },
    },
  }
  it("returns true for fields marked x-pii", () => {
    expect(isPiiField(schema, "email")).toBe(true)
  })
  it("returns false for non-pii fields", () => {
    expect(isPiiField(schema, "age_band")).toBe(false)
  })
  it("returns false for unknown schemas", () => {
    expect(isPiiField(null, "email")).toBe(false)
  })
})

describe("summariseProfileForLog", () => {
  it("returns log-safe summary without leaking values", () => {
    const summary = summariseProfileForLog({
      schema_version: 1,
      core: { summary: "x" } as any,
      custom: { age_band: "25-34" },
      extraction: { model: "m", status: "ok" },
    })
    expect(summary).toEqual({
      has_core: true,
      custom_keys: ["age_band"],
      extraction_status: "ok",
    })
  })

  it("handles missing profile gracefully", () => {
    const out = summariseProfileForLog(null)
    expect(out.has_core).toBe(false)
    expect(out.extraction_status).toBe("none")
  })
})
