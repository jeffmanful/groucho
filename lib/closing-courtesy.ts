/**
 * The configured final message owns the thank-you, goodbye and what happens next.
 * A model-written closing acknowledgement that adds its own courtesy or restates the
 * final message produces a doubled ending ("Thanks for chatting. Thanks for taking the
 * time to chat."), so those sentences are removed from the acknowledgement.
 */
const THANKS = /\b(?:thanks|thank you|grateful|appreciate)\b/i
const FAREWELL = /\b(?:take care|goodbye|bye|all the best|good luck|have a (?:good|great|nice|lovely))\b/i
const COURTESY_LEAD = /^(?:(?:no problem|no worries|understood|of course|okay|ok|sure|got it|all good)[,.!]?\s+)?(?:(?:many )?thanks|thank you|i (?:really |do )?appreciate (?:it|that|this|you(?:r time)?))(?:\s+(?:so|very) much|\s+a lot)?(?:\s+(?:for|again)\b[^,.!;]*)?/i
const FAREWELL_SENTENCE = /^(?:take care|bye|goodbye|all the best|good luck|have a (?:good|great|nice|lovely))\b[^.!?]*[.!]?$/i
// Thanking someone for a correction acknowledges the correction, not the conversation.
const CORRECTION = /\b(?:correct|clarif|fix|updat)/i

export function finalMessageThanks(finalMessage: string) {
  return THANKS.test(finalMessage)
}

export function finalMessageCloses(finalMessage: string) {
  return THANKS.test(finalMessage) || FAREWELL.test(finalMessage)
}

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []
const phrases = (text: string) => {
  const w = words(text)
  return new Set(w.slice(0, -2).map((word, i) => `${word} ${w[i + 1]} ${w[i + 2]}`))
}

export function withoutClosingCourtesy(acknowledgment: string, finalMessage: string): string {
  const trimmed = acknowledgment.trim()
  const closes = finalMessageCloses(finalMessage)
  const thanks = finalMessageThanks(finalMessage)
  const finalPhrases = phrases(finalMessage)
  // Sharing a three-word phrase with the final message means the sentence restates it.
  const restates = (sentence: string) => [...phrases(sentence)].some(phrase => finalPhrases.has(phrase))
  let changed = false
  const kept: string[] = []
  for (const sentence of trimmed.split(/(?<=[.!])\s+/)) {
    let rest = sentence.trim()
    for (;;) {
      const lead = rest.match(COURTESY_LEAD)
      if (lead && CORRECTION.test(lead[0])) {
        // Keep the correction acknowledgement but drop any thanks for the conversation tacked onto it.
        const after = rest.slice(lead[0].length).replace(/^[\s,;]*(?:and\s+)?/i, "")
        const remainder = /^(?:for|again)\b/i.test(after) ? "" : withoutClosingCourtesy(after, finalMessage)
        if (remainder !== after.trim()) rest = remainder ? `${lead[0].trim()}, ${remainder.charAt(0).toLowerCase()}${remainder.slice(1)}` : `${lead[0].trim()}.`
        break
      }
      if (restates(rest) || closes && FAREWELL_SENTENCE.test(rest)) { rest = ""; break }
      if (!lead || !thanks) break
      rest = rest.slice(lead[0].length).replace(/^[\s,;:.!—–-]+/, "")
      // "Thanks for talking with me, and for saying London." is courtesy throughout.
      if (/^(?:and\s+)?(?:for|again)\b/i.test(rest)) { rest = ""; break }
      rest = rest.replace(/^and\s+/i, "")
      rest = rest.charAt(0).toUpperCase() + rest.slice(1)
    }
    if (rest !== sentence.trim()) changed = true
    if (/\w/.test(rest)) kept.push(rest)
  }
  return changed ? kept.join(" ") : trimmed
}
