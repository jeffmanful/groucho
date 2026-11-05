/** Remove stock approval sentences, keeping Mo's actual questions and musical opinions. */
export function formatMoReply(reply: string): string {
  const approval = /\b(?:(?:good|great|nice|lovely) (?:choice|mix|idea|one|place to start)|proper (?:evening|night|way)|right up (?:Rosa|Jem|Nia|Ash)'?s street|sounds like the right call)\b/i
  const emptyAcknowledgment = /^(?:a (?:gig|track)[,!]?\s*)?(?:good|nice|lovely|fair enough)[.!]?$/i
  return reply.split(/(?<=[.!?])\s+/)
    .filter(sentence => sentence.includes("?") || !approval.test(sentence) && !emptyAcknowledgment.test(sentence.trim()))
    .join(" ").trim()
}
