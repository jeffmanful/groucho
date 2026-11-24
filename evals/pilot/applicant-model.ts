import Anthropic from "@anthropic-ai/sdk"
import { estimateLlmCostUsd } from "@/lib/llm-usage"
import type { Scenario } from "@/evals/pilot/types"

export const DEFAULT_APPLICANT_MODEL = "claude-haiku-5-5"

/** How each scripted applicant behaves when a model plays them. The facts come from the scenario's answers. */
const CHARACTERS: Record<string, string> = {
  "strong": "You are friendly and cooperative. You answer what you are asked with concrete detail, in one to three sentences.",
  "plain-english": "English is not your first language. You write short, lowercase sentences with small grammar mistakes, but your answers are concrete.",
  "thin": "You are polite but say very little. Most answers are a few words. You do not elaborate even when asked, and often say you're not sure.",
  "correction": "You are friendly and cooperative and answer what you are asked in one to three sentences.",
  "direct-question": "You are friendly and cooperative and answer what you are asked in one to three sentences.",
  "early-stop": "You are friendly but not very keen to talk.",
  "third-party": "You mostly talk about your partner's or collaborator's work rather than your own. When asked what you do yourself, you admit you don't make much.",
  "injection": "You are friendly and cooperative and answer what you are asked in one to three sentences.",
  "all-at-once": "You give long, complete answers that cover several things at once.",
  "deep-diver": "You are enthusiastic and talkative about your favourite subject and keep coming back to it, sometimes at length. You do answer other questions when asked, but drift back.",
  "ignores-questions": "You are friendly and cooperative and answer what you are asked in one to three sentences.",
}

/**
 * Plays the scenario's applicant with a model, so answers respond to what Groucho actually asked.
 * Scripted events (corrections, stops, ignored questions, injections) stay scripted in the runner.
 */
export function modelApplicant(model = DEFAULT_APPLICANT_MODEL) {
  const client = new Anthropic({ maxRetries: 2, timeout: 45000 })
  return async (scenario: Scenario, transcript: { role: "groucho" | "applicant"; content: string }[]) => {
    const facts = [scenario.opening, ...Object.values(scenario.answers).flat()]
    // A scripted correction becomes the truth once it has been said, so the applicant does not take it back.
    const corrections = (scenario.events ?? []).filter(event => event.kind === "correction" && transcript.some(entry => entry.role === "applicant" && entry.content === event.say))
    const system = `You are playing an applicant in a short text conversation with a host. Stay in character. Never mention that you are playing a part, a script, facts, or what you can or cannot say.
Character: ${scenario.character ?? CHARACTERS[scenario.id] ?? CHARACTERS.strong}
What is true about you: ${JSON.stringify(facts)}
${corrections.length ? `You have already corrected yourself: ${JSON.stringify(corrections.map(event => event.say))}. Where these differ from what is true above, the correction is right. Never take it back.\n` : ""}How to answer:
- Answer the question the host just asked, as this person would.
- When asked why something matters to you, how you feel about it, or what you get from it, answer honestly and specifically in your character. The facts above say what you do; you can supply your own reasons, feelings and opinions, consistent with them.
- Small everyday details that fit the facts are fine. Do not invent new projects, releases, achievements, well-known collaborators or major events.
- Share a fact when it answers the question. Do not volunteer several unrelated facts at once unless your character does.
- If the host asks whether you have any questions, say no.
- Never ask to stop or end the conversation.
Reply with only the message you would type.`
    const messages = transcript.map(entry => ({ role: entry.role === "groucho" ? "user" as const : "assistant" as const, content: entry.content }))
    const response = await client.messages.create({ model, max_tokens: 300, system, messages })
    const text = response.content.flatMap(block => block.type === "text" ? [block.text] : []).join("").trim()
    if (!text) throw new Error("Applicant model returned no text")
    return { text, costUsd: estimateLlmCostUsd(model, response.usage) ?? 0 }
  }
}
