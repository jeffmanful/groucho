import Anthropic from "@anthropic-ai/sdk"
import {
  DEFAULT_LOW_COST_ANTHROPIC_MODEL,
  logLlmUsage,
  modelFromEnv,
} from "@/lib/llm-usage"

export type ArtistContextConfidence = "high" | "medium" | "low" | "unknown"

export type ArtistContext = {
  query: string
  summary: string
  genres?: string[]
  culturalNotes?: string[]
  confidence: ArtistContextConfidence
}

const ENRICHMENT_MODEL_ENV = "GROUCHO_ARTIST_ENRICHMENT_MODEL"
const MAX_GENRES = 5
const MAX_CULTURAL_NOTES = 4

const ENRICHMENT_SYSTEM = `You enrich artist references for a cultural gatekeeper conversation.

Return ONLY a JSON object. No commentary, no markdown fences.

Keys:
- "summary": <=240 chars, brief neutral description of the artist or creative figure if recognized
- "genres": optional string array (<=5), short genre/style labels
- "culturalNotes": optional string array (<=4), short notes about cultural context, community, or significance
- "confidence": one of "high" | "medium" | "low" | "unknown"

Rules:
- This is for follow-up question quality only, not verification.
- If the name is obscure, ambiguous, or unknown, return confidence "unknown" and a minimal summary like "No reliable public context found."
- Do not invent detailed biographical facts when uncertain.
- Treat musicians, bands, producers, DJs, and visual artists similarly.`

let client: Anthropic | null = null

function getClient(): Anthropic {
  if (!client) client = new Anthropic()
  return client
}

function asStringArray(raw: unknown, maxLen: number): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const values = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxLen)
  return values.length > 0 ? values : undefined
}

function normaliseConfidence(raw: unknown): ArtistContextConfidence {
  if (raw === "high" || raw === "medium" || raw === "low" || raw === "unknown") {
    return raw
  }
  return "unknown"
}

export function normaliseArtistContext(
  query: string,
  raw: unknown,
): ArtistContext | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const data = raw as Record<string, unknown>
  const summary = typeof data.summary === "string" ? data.summary.trim() : ""
  if (!summary) return null

  return {
    query,
    summary: summary.slice(0, 240),
    genres: asStringArray(data.genres, MAX_GENRES),
    culturalNotes: asStringArray(data.culturalNotes, MAX_CULTURAL_NOTES),
    confidence: normaliseConfidence(data.confidence),
  }
}

export async function enrichArtistContext(query: string): Promise<ArtistContext | null> {
  const trimmed = query.trim()
  if (!trimmed) return null

  try {
    const model = modelFromEnv(
      ENRICHMENT_MODEL_ENV,
      DEFAULT_LOW_COST_ANTHROPIC_MODEL,
    )
    const response = await getClient().messages.create({
      model,
      max_tokens: 256,
      system: ENRICHMENT_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Artist or creative figure named by applicant: ${trimmed}`,
        },
      ],
    })
    logLlmUsage({
      operation: "artist_context_enrichment",
      provider: "anthropic",
      model,
      usage: response.usage,
    })

    const textBlock = response.content.find((block) => block.type === "text")
    if (!textBlock || textBlock.type !== "text") return null

    let raw: unknown
    try {
      raw = JSON.parse(textBlock.text)
    } catch {
      return null
    }

    return normaliseArtistContext(trimmed, raw)
  } catch {
    return null
  }
}
