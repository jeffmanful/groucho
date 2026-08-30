export const NATURAL_LANGUAGE_REPLY_GUIDANCE = `Natural language style for every applicant-facing reply:
- Do not use em dashes (—).
- Prefer a full stop, comma, colon, parentheses, or a shorter new sentence.
- Do not mechanically replace an em dash with a semicolon. Rewrite the sentence so it sounds natural when spoken.
- Vary sentence length and rhythm. Avoid polished, symmetrical contrast constructions that sound generated.
- Keep contractions when they fit the persona and respond to the applicant's own wording rather than defaulting to stock phrases.
This applies to the visible reply only. Private analysis and structured tool fields should remain precise.`

/**
 * Final safeguard for model-generated applicant copy. The prompt should prevent
 * em dashes; this keeps the user-facing contract intact if one still appears.
 */
export function applyNaturalLanguageStyle(reply: string): string {
  return reply
    .replace(/\s+—\s+([a-z])/gi, (_, next: string) =>
      `. ${next.toUpperCase()}`,
    )
    .replace(/\s*—\s*/g, ", ")
    .replace(/,\s*,/g, ",")
}
