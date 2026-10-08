/** COLORS persona template — see COLORS_PERSONA_SPEC.md */

export const COLORS_PROFILE_EXTRACTOR_HINT =
  "Extract practical, human-readable fields that help COLORS understand why the person came, their artist interests, participation in communities, Forum hopes, reciprocal contribution, and relationship to COLORS. Do not invent details."

export const COLORS_THIN_PROFILE_EVIDENCE_HINT =
  "Base risk flags and the core summary only on explicit applicant conduct or intent. Do not infer legal violations, ownership, identity, or a sustained practice from a short conversation. Use 'the applicant' or they/their in all fields; never infer he/she pronouns or other identity from musical interests. Groucho's broad hypothetical about ordinary music sharing does not establish an applicant concern. Do not carry uncertainty in response to a hypothetical into the summary or risk flags. Preserve the exchange in factual Q&A if useful."

export const COLORS_FORUM_MEMBERSHIP_PROFILE_HINT =
  "Populate each defined custom field when direct applicant evidence supports it; one answer may support several fields. Summarise only what the applicant actually said about joining, COLORS, music, other communities, TONES, and their preferred way to take part. Leave unknown custom fields empty. A stated online discussion belongs in community_participation even when the applicant also describes an event. Prior COLORS or TONES familiarity and live-event attendance are optional context, never risk flags or a measure of worth. Do not infer attendance from interest in TONES. Sharing links to publicly available music is ordinary Forum activity, not an artist-permission concern. A story about a different musical perspective may describe community participation, but never invent such a story or pose a hypothetical as past conduct."

export const COLORS_FORUM_MEMBERSHIP_PROFILE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    joining_reason: { type: "string", description: "Why they want to join the Forum." },
    colors_connection: { type: "string", description: "Their actual prior connection to COLORS, including a named show or artist only if they volunteered one." },
    music_relationship: { type: "string", description: "How music features in their life as a listener, maker, scene participant or another role they described." },
    community_participation: { type: "string", description: "How they say they show up in other online or offline communities, with a concrete example if given." },
    tones_connection: { type: "string", description: "What they actually know about or experienced with TONES; leave empty if unmentioned or unfamiliar." },
    forum_hopes: { type: "string", description: "What they hope to find or make possible in the Forum." },
    initial_participation: { type: "string", description: "How they would prefer to take part at first, if stated; reading and listening count." },
  },
  additionalProperties: false,
}

export const COLORS_PROFILE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      description: "What brought the person to the forum.",
    },
    artist_reference: {
      type: "string",
      description:
        "The artist they named and why they think more people should know about them.",
    },
    recommendation: {
      type: "string",
      description:
        "The last song they recommended and why they thought it was worth sharing.",
    },
    forum_hopes: {
      type: "string",
      description: "What they hope to find or help make possible in the Forum.",
    },
    participation_style: {
      type: "string",
      description: "The selected participation style.",
    },
    forum_contribution: {
      type: "string",
      description: "What they say they would add to the forum.",
    },
  },
  additionalProperties: false,
}

export const COLORS_DEFAULT_WELCOME =
  "Thanks for being here. A few short questions will help us understand how you want to participate."
