import Anthropic from "@anthropic-ai/sdk"
import type { ConversationMessage } from "@/lib/scoring"

const COMPLETION_MODEL = "claude-sonnet-4-20250514"
const MAX_TOKENS = 120

const DEFAULT_CLOSING =
  "Thanks — you're all set. We'll use what you shared to personalise your experience."

let client: Anthropic | null = null
function getClient(): Anthropic {
  if (!client) client = new Anthropic()
  return client
}

function transcriptLines(transcript: ConversationMessage[]): string {
  return transcript
    .map((m) => `${m.role === "assistant" ? "ASSISTANT" : "USER"}: ${m.content}`)
    .join("\n")
}

export async function generateOnboardingCompletion(
  personaPrompt: string,
  transcript: ConversationMessage[],
): Promise<string> {
  try {
    const response = await getClient().messages.create({
      model: COMPLETION_MODEL,
      max_tokens: MAX_TOKENS,
      system: `${personaPrompt.trim()}

Write ONE short closing message (max 2 sentences) thanking the user and reflecting one specific thing they shared. Calm, human, no hype. Do not ask another question.`,
      messages: [
        {
          role: "user",
          content: `Conversation:\n\n${transcriptLines(transcript)}`,
        },
      ],
    })
    const text = response.content.find((b) => b.type === "text")
    if (text && text.type === "text" && text.text.trim()) {
      return text.text.trim().slice(0, 400)
    }
  } catch {
    /* fallback */
  }
  return DEFAULT_CLOSING
}

export { DEFAULT_CLOSING }
