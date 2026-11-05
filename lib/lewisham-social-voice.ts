/** Remove stock approval sentences, keeping Mo's actual questions and musical opinions. */
export function formatMoReply(reply: string): string {
  const approval = /\b(?:(?:good|great|nice|lovely) (?:choice|mix|idea|one|spread|test|place to start)|proper (?:evening|night|way|room-wide moment)|right up (?:Rosa|Jem|Nia|Ash)['’]?s street|sounds like the right call)\b/i
  const emptyAcknowledgment = /^(?:(?:[^.!?]{1,80},\s*)|(?:a (?:gig|track)\s+))?(?:good|nice|lovely|fair enough|then)[.!]?$/i
  const evaluativePreamble = /\b(?:(?:a|an|the) (?:good|great|nice|lovely|proper)\b|(?:is|was|sounds|seems|feels|that's|it's) (?:good|great|nice|lovely)\b)/i
  return reply.split(/(?<=[.!?])\s+/)
    .filter(sentence => {
      if (sentence.includes("?")) return true
      if (approval.test(sentence) || emptyAcknowledgment.test(sentence.trim())) return false
      const ownOpinion = /^(?:I\b|I've\b|I'm\b|My\b|For me\b)/i.test(sentence.trim()) && !/\b(?:your|choice|taste|plans)\b/i.test(sentence)
      return ownOpinion || !evaluativePreamble.test(sentence)
    })
    .join(" ").trim()
}
