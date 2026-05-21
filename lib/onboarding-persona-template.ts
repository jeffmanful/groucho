/** COLORS persona template — see COLORS_PERSONA_SPEC.md */

export const COLORS_PROFILE_EXTRACTOR_HINT =
  "Extract practical, human-readable fields that help COLORS understand intent, creative relationship, community care, belonging needs, contribution style, and any safety context. Do not invent details. Keep sensitive identity details only when explicitly shared and relevant."

export const COLORS_PROFILE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      description: "Why the person is drawn to COLORS beyond music discovery.",
    },
    creative_relationship: {
      type: "string",
      description:
        "What kind of creative expression resonates with them and why.",
    },
    community_care: {
      type: "string",
      description:
        "What they believe people should protect for each other in creative community.",
    },
    belonging: {
      type: "string",
      description:
        "What helps them feel safe, respected, and able to show up fully.",
    },
    contribution: {
      type: "string",
      description: "How they want to contribute without adding noise.",
    },
    safety_context: {
      type: "string",
      description:
        "Relevant safety, care, access, or wellbeing context explicitly shared by the user.",
      "x-pii": true,
    },
  },
  additionalProperties: false,
}

export const COLORS_DEFAULT_WELCOME =
  "Thanks for being here. A few short questions will help us understand how you want to participate."
