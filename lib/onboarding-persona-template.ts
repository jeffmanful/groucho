/** COLORS persona template — see COLORS_PERSONA_SPEC.md */

export const COLORS_PROFILE_EXTRACTOR_HINT =
  "Extract practical, human-readable fields that help COLORS understand why the person came, their artist reference, recommendation taste, community values, participation style, and likely forum contribution. Do not invent details."

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
    community_value: {
      type: "string",
      description:
        "How they would respond constructively to unfinished music that is not for them.",
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
