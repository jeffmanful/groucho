# Personas

Personas define how Groucho sounds, how gatekeeper decisions should be made, and what custom profile fields should be extracted from completed sessions.

In the current implementation, personas are global platform-managed records. Organisation members can read personas for project configuration, but only platform admins can create, edit, or delete them.

## Data Model

The `personas` table stores:

- `name` - Human-readable label in admin UI.
- `slug` - Unique stable identifier.
- `prompt` - System prompt used by the conversation engine.
- `is_active` - Whether the persona can be selected.
- `is_default` - Fallback persona when a project or request does not specify one.
- `pass_threshold` - Legacy fallback threshold when an old plain-text pass token is returned.
- `reject_threshold` - Legacy fallback threshold when an old plain-text reject token is returned.
- `profile_schema` - Optional JSON object defining custom extracted profile fields.
- `profile_extractor_hint` - Optional natural-language extraction guidance.

Only one persona is intended to be default. When a persona is saved as default, other defaults are cleared.

## How Personas Are Used

Gatekeeper projects:

- The persona prompt drives tone, questioning style, and semantic pass/redirect/reject judgment.
- The runtime appends Groucho's structured outcome instructions.
- The model must call `groucho_respond` with `reply` and `terminal`.
- The structured `terminal` value is authoritative. `pass_threshold` and `reject_threshold` only normalize legacy plain-text decision tokens.

Onboarding projects:

- The project flow controls question order.
- The persona prompt controls tone, bridge acknowledgements, follow-up style, boundary replies, and personalized completion.
- The persona should not try to reorder or skip configured onboarding steps.

Profile extraction:

- On terminal sessions, Groucho extracts a `profile`.
- `profile_schema` defines the `profile.custom` fields.
- `profile_extractor_hint` gives the extractor additional brand-specific instructions.

## Creating A Persona

Platform admins can create personas through `POST /api/admin/personas`.

Example gatekeeper persona:

```json
{
  "name": "COLORS Application Host",
  "slug": "colors-application-host",
  "prompt": "You are the COLORS application host. You are calm, selective, and direct. Treat the project's signals as private evidence intents and any question wording as illustrative only. Infer each next question from the applicant's answer, the live thread, the relevant intent, and the persona. Do not reward polish or name-dropping. Never ask who received or was sent a music recommendation; ask only what was recommended and why it felt worth sharing. Produce a private advisory COLORS recommendation of recommend, human_review, or decline; map these to Groucho terminal values pass, redirect, and reject until project-specific terminal enums exist. Decline is private and must not be shown as an applicant-facing rejection. Every completed application should produce a reviewer-facing report or bio with a confidence score, and the final community decision always belongs to COLORS/the client. Treat the configured turn count as a soft target; use per-intent follow-up limits and the runtime emergency stop to avoid loops. Keep internal outcomes private and use the configured neutral closing message.",
  "is_active": true,
  "is_default": false,
  "pass_threshold": 0.65,
  "reject_threshold": 0.25,
  "profile_schema": {
    "type": "object",
    "properties": {
      "intent": {
        "type": "string",
        "description": "Why the applicant wants access beyond general interest."
      },
      "community_awareness": {
        "type": "string",
        "description": "Evidence that the applicant understands care, safety, and attention in creative community."
      },
      "contribution_style": {
        "type": "string",
        "description": "How the applicant says they would contribute or participate."
      }
    }
  },
  "profile_extractor_hint": "Prefer concrete details and direct quotes. Do not invent motivations."
}
```

Example onboarding persona:

```json
{
  "name": "COLORS Onboarding Host",
  "slug": "colors-onboarding-host",
  "prompt": "You are the COLORS onboarding host. You are calm, thoughtful, emotionally intelligent, and observant. Guide people through a short onboarding conversation about creativity, community, care, and cultural participation. Ask one question at a time. Keep responses short. Protect dignity and belonging first.",
  "is_active": true,
  "is_default": false,
  "pass_threshold": 0.65,
  "reject_threshold": 0.25,
  "profile_schema": {
    "type": "object",
    "properties": {
      "intent": {
        "type": "string",
        "description": "Why the person is drawn to COLORS beyond music discovery."
      },
      "creative_relationship": {
        "type": "string",
        "description": "What kind of creative expression resonates with them and why."
      },
      "community_care": {
        "type": "string",
        "description": "What they believe people should protect for each other in creative community."
      },
      "belonging": {
        "type": "string",
        "description": "What helps them feel safe, respected, and able to show up fully."
      },
      "contribution": {
        "type": "string",
        "description": "How they want to contribute without adding noise."
      }
    }
  },
  "profile_extractor_hint": "Map onboarding answers to the matching custom fields. Keep sensitive details only when explicitly shared and relevant."
}
```

## Profile Schema Rules

`profile_schema` must be a JSON object with this shape:

```json
{
  "type": "object",
  "properties": {
    "field_name": {
      "type": "string",
      "description": "What to extract.",
      "x-pii": true
    }
  }
}
```

Rules enforced today:

- The root must declare `"type": "object"`.
- `properties` must be an object.
- Property names must match `[A-Za-z_][A-Za-z0-9_]*`.
- Field definitions must be objects.
- `profile_extractor_hint` is trimmed and capped at 2000 characters.

Use `"x-pii": true` for fields that may contain personal data. Admin profile views mask these values until an org admin reveals them.

See [profile-schema-guide.md](./profile-schema-guide.md) for more detail.

## Deleting Personas

A persona cannot be deleted if any session references it. The delete route checks `sessions.persona_id` and returns `409` if sessions exist.

For old or retired personas, prefer setting `is_active` to `false`. This keeps historical sessions readable while preventing new project configuration from using the persona.

## Configuration Guidance

- Keep prompts concise and behavioral. Explain what good and concerning answers look like.
- For gatekeeper personas, describe when to pass, redirect, or reject, or document the project's private outcome mapping. The runtime handles the structured tool contract.
- For onboarding personas, describe tone and boundaries. Do not put the full ordered question list in the prompt; configure those on the project.
- Keep custom profile schemas small. Five to ten fields is usually enough.
- Use different personas for application and onboarding if the brand voice changes between selection and welcome.
