/** Remove stock approval sentences, keeping Mo's actual questions and musical opinions. */
export function formatMoReply(reply: string): string {
  const approval = /\b(?:(?:good|great|nice|lovely) (?:choice|mix|idea|one|spread|test|place to start)|proper (?:evening|night|way|room-wide moment)|right up (?:Rosa|Jem|Nia|Ash)['’]?s street|sounds like the right call)\b/i
  const emptyAcknowledgment = /^(?:(?:[^.!?]{1,80},\s*)|(?:a (?:gig|track)\s+))?(?:good|nice|lovely|fair enough)[.!]?$/i
  const evaluativePreamble = /\b(?:(?:a|an|the) (?:good|great|nice|lovely|proper)\b|(?:is|was|sounds|seems|feels|that's|it's) (?:good|great|nice|lovely)\b)/i
  return reply.split(/(?<=[.!?])\s+/)
    .filter(sentence => {
      if (sentence.includes("?")) return true
      if (/^a (?:gig|track),? then[.!]?$/i.test(sentence.trim())) return false
      if (approval.test(sentence) || emptyAcknowledgment.test(sentence.trim())) return false
      const ownOpinion = /^(?:I\b|I've\b|I'm\b|My\b|For me\b)/i.test(sentence.trim()) && !/\b(?:your|choice|taste|plans)\b/i.test(sentence)
      return ownOpinion || !evaluativePreamble.test(sentence)
    })
    .map(sentence => sentence.includes("?")
      ? sentence.replace(/,?\s+\b(?:and|or)\s+(?:what|who|where|when|why|how|which|was|were|is|are|did|do|does|would|could|have|has|had|can|will|should|might|must)\b[^?]*\?/i, "?")
      : sentence)
    .join(" ").trim()
}

/** Broad requests for the same information, regardless of their surface wording.
 * Specific follow-ups (a named artist, a lyric, a gig event) remain free-form.
 */
export function moQuestionTopic(reply: string): string | undefined {
  const question = reply.split(/[.!]/).find(part => part.includes("?"))?.toLowerCase() ?? ""
  if (/\bother (?:bands|artists|records|music)\b|\bon repeat\b|\bwho else\b.*\b(?:listen|listening|repeat|see|seeing|go back|put on)\b|\bwhat else\b.*\b(?:listen|listening|had on|music|repeat)\b|\bwhat(?:'s| is| has| have you)\b.*\blistening to\b/.test(question)) return "otherInterests"
  if (/\b(?:particular|favourite) (?:moment|lyric|song)\b|\bwhat caught your ear\b|\bwhat (?:is it|was it) about the band\b|\bwhat (?:draws|drew|connects) you\b/.test(question)) return "connection"
  if (/\bhow did you (?:first )?(?:hear|find|discover)\b/.test(question)) return "discovery"
  if (/\bwho (?:are you|will you be|would you be) (?:bringing|taking|going with)\b|\bwho (?:would|will|might|do) you (?:bring|take|go with)\b|\bwho(?:\x27s| is) (?:coming|going) with you\b/.test(question)) return "companion"
  if (/\bwhere\b.*\b(?:travell?ing|coming|from)\b/.test(question)) return "location"
  if (/\b(?:which|what) night\b/.test(question)) return "night"
  return undefined
}
