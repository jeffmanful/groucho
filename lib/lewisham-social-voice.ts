/** Remove stock approval sentences, keeping Mo's actual questions and musical opinions. */
export function formatMoReply(reply: string): string {
  const approval = /\b(?:(?:good|great|nice|lovely) (?:choice|mix|idea|one|spread|test|place to start)|proper (?:evening|night|way|room-wide moment)|right up (?:Rosa|Jem|Nia|Ash)['’]?s street|sounds like the right call)\b/i
  const emptyAcknowledgment = /^(?:(?:[^.!?]{1,80},\s*)|(?:a (?:gig|track)\s+))?(?:good|nice|lovely|fair enough|then)[.!]?$/i
  return reply.split(/(?<=[.!?])\s+/)
    .filter(sentence => sentence.includes("?") || !approval.test(sentence) && !emptyAcknowledgment.test(sentence.trim()))
    .join(" ").trim()
}
