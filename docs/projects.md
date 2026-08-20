# Projects

Projects are the runtime configuration unit in Groucho. A project belongs to one organisation and defines which flow runs, which persona is used, how sessions are exposed, which API keys authenticate host apps, and where terminal events are sent.

An organisation can have multiple projects. For example, COLORS can run one project for applications and another project for onboarding.

## Data Model

The `projects` table stores:

- `id`
- `organisation_id`
- `name`
- `slug`
- `expose_to_anon_read`
- `settings` JSON
- timestamps

Related project-scoped tables:

- `api_keys` authenticate Project API requests.
- `webhooks` receive terminal session events.
- `sessions` store each conversation.
- `messages` store user and assistant turns.
- `verdicts` store terminal outcomes and webhook payloads.

## Project Types

`settings.project_type` controls the runtime.

Supported values:

```json
["gatekeeper", "onboarding"]
```

If omitted or invalid, the project is treated as `gatekeeper`.

### Gatekeeper Projects

Gatekeeper projects are application or access-decision flows.

They:

- Start with a configured opening message.
- Let the persona decide what to ask.
- End with `passed`, `redirected`, or `rejected`.
- Return a private accumulated assessment in the same structured response as each conversational turn.
- Can return a `secret` when passed for downstream access capture.

### Onboarding Projects

Onboarding projects are structured intake flows.

They:

- Use `flow_config.steps` as the source of truth.
- Bootstrap the first assistant message with `POST /v1/sessions/{id}/start`.
- Advance through fixed steps in order.
- Can ask one cheap heuristic follow-up per step when enabled.
- Can opt into LLM bridge, boundary, completion, or profile extraction, but these are off by default.
- Complete as `passed` after the final configured step.
- Extract a profile using the onboarding step keys and persona schema only when `profile_extract_on` is explicitly configured.

## Common Settings

These settings are used by both project types:

```json
{
  "project_type": "gatekeeper",
  "use_case": "community_gate",
  "environment": "test",
  "session_mode": "dry-run",
  "persona_id": "00000000-0000-0000-0000-000000000000",
  "pass_threshold": 0.65,
  "reject_threshold": 0.25,
  "profile_extract_on": ["passed", "redirected", "rejected"]
}
```

Fields:

- `project_type` - `gatekeeper` or `onboarding`.
- `use_case` - Admin UI grouping; currently `community_gate`, `b2b_trial`, `event_access`, or `other`.
- `environment` - `test` or `live`.
- `session_mode` - `dry-run` or `live`.
- `persona_id` - Preferred persona for the project.
- `pass_threshold` - Used only to normalize legacy plain-text pass tokens.
- `reject_threshold` - Used only to normalize legacy plain-text reject tokens.
- `profile_extract_on` - Optional profile extraction control. Gatekeeper projects default to all terminal statuses. Onboarding projects default to no extraction so static intake does not call an LLM unless this is explicitly set. Use `["passed"]` to extract only on passes, or `false` / `null` to disable extraction.

## Gatekeeper Configuration

Gatekeeper projects can configure the application experience:

```json
{
  "project_type": "gatekeeper",
  "persona_id": "11111111-1111-1111-1111-111111111111",
  "application_experience": {
    "opening_message": "Welcome. A few questions first.\n\nWe are looking for people who understand care, creativity, and community beyond access.",
    "closing_message": "It was good getting to understand you better.",
    "opening_interaction": {
      "inputType": "singleSelect",
      "options": ["Artist", "Curator", "Organiser"]
    },
    "required_signals": [
      "Why they want to join",
      "What they would contribute",
      "How they understand community care"
    ],
    "preferred_input_types": ["text", "singleSelect"],
    "max_turns": 4
  },
  "pass_threshold": 0.65,
  "reject_threshold": 0.25
}
```

`application_experience` fields:

- `opening_message` - First assistant message before the applicant replies. Defaults to a first application question when missing.
- `closing_message` - Final applicant-facing application message. Defaults to a neutral thank-you/follow-up message. Groucho still records the internal `passed`, `redirected`, or `rejected` outcome for webhooks and admin review, but the applicant should not see a definitive judgment. Project-specific reviewer labels, such as COLORS' `recommend`, `human_review`, and `decline`, must also remain private. For COLORS, these labels are advisory report fields only; the final community decision remains human-owned by the client.
- `opening_interaction` - Optional first-turn input control (`text`, `singleSelect`, or `multiSelect`). Clients can override per session via `startSession({ openingInteraction })`.
- `required_signals` - Private evidence intents Groucho may need to understand. Existing question-shaped strings are illustrative examples, not an ordered script or required wording. Groucho stores evidence against stable derived keys and sends compact signal state rather than the full transcript.
- `preferred_input_types` - Hints for when to use open text vs structured inputs.
- `max_turns` - Optional soft pacing target. The runtime may continue when a live thread or decision-relevant uncertainty earns another question, with a separate higher emergency loop stop.

If `application_experience.opening_message` is missing or empty, Groucho uses:

```text
What brings you here, and what do you think you would add?
```

The opening message is shown to the user before their first reply. The runtime also seeds the model history with that opener so the persona treats the user's first message as a response to it.

The final gatekeeper message is persona-driven. The assistant calls the structured `groucho_respond` tool with:

```json
{
  "reply": "User-visible final line.",
  "terminal": "pass"
}
```

`terminal` can be:

```json
["none", "pass", "redirect", "reject"]
```

When `terminal` is not `none`, the session ends.

The applicant-facing terminal `message` is always normalized to `application_experience.closing_message`, regardless of the internal terminal value. Do not use copy such as "Welcome in", "Rejected", or "Not the right fit" for application endings.

Applicants do not need an account before applying. The default SDK experience
collects their email before starting the conversation, and public API clients
provide the normalized `applicant.email` envelope at session start. Groucho
stores it as `sessions.applicant_email` so approved applicants can receive an
account invitation after review. `/doorcheck` mirrors this lifecycle by
collecting a fresh email before each preview application and attaching it to the
session.

### Artist reference enrichment

When the previous assistant turn asked for an artist or creative reference and the applicant replies with a short name, Groucho may enrich that reference server-side with brief LLM-generated context before generating the next follow-up.

This enrichment is used only to help Doorman ask a sharper personal follow-up. It is **not** used to verify that the artist exists and is **not** a pass/fail criterion.

Enriched context is stored on the user message metadata as `artist_context` for audit/debugging. It is not exposed in the public message API response in v1.

## Onboarding Configuration

Onboarding projects require `flow_config.steps`.

```json
{
  "project_type": "onboarding",
  "persona_id": "22222222-2222-2222-2222-222222222222",
  "flow_config": {
    "version": "colors-2026-05-21",
    "welcome_message": "Thanks for being here. A few short questions will help us understand how you want to participate.",
    "steps": [
      {
        "id": "intent",
        "title": "Intent",
        "question": "What draws you to COLORS, beyond discovering new music?",
        "profile_key": "intent",
        "required": true,
        "hint": "Share what you are looking for, not just discovery."
      },
      {
        "id": "creative_relationship",
        "title": "Creative Relationship",
        "question": "What kind of creative expression tends to stay with you, and why?",
        "profile_key": "creative_relationship",
        "required": true
      },
      {
        "id": "community_care",
        "title": "Community Care",
        "question": "When you enter a creative community, what do you think people should protect for each other?",
        "profile_key": "community_care",
        "required": true
      }
    ]
  },
  "onboarding_experience": {
    "bridge_enabled": false,
    "followup_enabled": true,
    "boundary_enabled": false,
    "personalized_completion": false
  }
}
```

Step fields:

- `id` - Stable step id. Must match `^[a-z][a-z0-9_-]{0,31}$`.
- `title` - Internal/display label, max 64 characters.
- `question` - User-visible question, max 500 characters.
- `profile_key` - Field key used for extracted profile mapping. Must match `^[a-z][a-z0-9_]{0,47}$`.
- `required` - Stored for configuration; current runtime asks configured steps in order.
- `intro` - Optional short text shown before the question.
- `hint` - Optional host UI input hint for the active step.
- `interaction` - Optional step input control (`text`, `singleSelect`, or `multiSelect`) with `options` for select inputs.
- `followup_prompt` - Optional custom follow-up if an answer is brief or vague.
- `min_answer_chars` - Optional heuristic threshold for follow-up prompts. Defaults to 24.

`onboarding_experience` fields:

- `bridge_enabled` - Allows LLM-generated persona-voiced acknowledgements between steps. Default off.
- `followup_enabled` - Allows one clarifying follow-up per step, using the cheap length heuristic when LLM intelligence is otherwise off. Default on.
- `boundary_enabled` - Allows LLM-generated calm pushback when answers undermine dignity or safety. Default off.
- `personalized_completion` - Generates an LLM-written closing line after the final answer. When disabled, Groucho uses the default closing. Default off.

## API Keys

Each project can have its own API keys. Keys are created by org admins:

```json
{
  "label": "Production host app"
}
```

The response includes `secret` once:

```json
{
  "id": "key-id",
  "key_prefix": "gk_live_abcd",
  "label": "Production host app",
  "secret": "gk_live_..."
}
```

Store the secret server-side. Do not send it to the browser. Host apps should usually proxy Groucho requests through their own backend and attach the `Authorization: Bearer gk_*` header there.

## Webhooks

Projects can send terminal events to HTTPS endpoints.

Example:

```json
{
  "label": "COLORS CRM",
  "url": "https://example.com/groucho/webhook",
  "events": ["session.completed"]
}
```

Rules:

- `url` must start with `https://`.
- If `events` is omitted, Groucho uses `["session.completed"]`.
- The response includes `signing_secret` once. Store it for HMAC verification.

## Example: COLORS Applications Project

```json
{
  "project_type": "gatekeeper",
  "use_case": "community_gate",
  "environment": "test",
  "session_mode": "dry-run",
  "persona_id": "colors-application-persona-id",
  "application_experience": {
    "opening_message": "Why do you want to be an early applicant for the Forum?",
    "closing_message": "It was good getting to understand you better.",
    "opening_interaction": { "inputType": "text" },
    "required_signals": [
      "What brought you here?",
      "Name an artist more people should know about. What would you want someone hearing them for the first time to notice?",
      "What's the last song you recommended, and why did you think it was worth sharing?",
      "Someone shares unfinished music that isn't really for you. How would you respond?",
      "Which sounds most like you?",
      "What's one thing you could realistically contribute in your first month?"
    ],
    "preferred_input_types": ["text", "singleSelect"],
    "max_turns": 9
  },
  "pass_threshold": 0.65,
  "reject_threshold": 0.25,
  "profile_extract_on": ["passed", "redirected", "rejected"]
}
```

Use this when the user is applying for access and Groucho should make a decision.

For the current COLORS application, the reviewer-facing product recommendation maps to Groucho's raw terminal outcome like this:

| COLORS recommendation | Groucho terminal outcome | Review meaning |
| --- | --- | --- |
| `recommend` | `passed` | Evidence supports approval, but the client still makes the final decision. |
| `human_review` | `redirected` | Evidence is incomplete, contradictory, borderline, or uncertain. |
| `decline` | `rejected` | Evidence suggests poor fit, but the client still makes the final decision. |

The COLORS flow may finish early once it has enough evidence. It may ask no more than nine applicant-facing questions total, including follow-ups, and no more than two follow-ups for any one core question. Each completed application should produce a reviewer-facing report or bio with a confidence score. These follow-up and reviewer-report rules are product rules; add dedicated settings before relying on platform-level enforcement.

## Example: COLORS Onboarding Project

```json
{
  "project_type": "onboarding",
  "use_case": "community_gate",
  "environment": "test",
  "session_mode": "dry-run",
  "persona_id": "colors-onboarding-persona-id",
  "flow_config": {
    "version": "colors-2026-05-21",
    "welcome_message": "Thanks for being here. A few short questions will help us understand how you want to participate.",
    "steps": [
      {
        "id": "intent",
        "title": "Intent",
        "question": "What brought you here?",
        "profile_key": "intent",
        "required": true,
        "interaction": {
          "inputType": "singleSelect",
          "options": ["Discover", "Community", "Share Work"]
        }
      },
      {
        "id": "artist_reference",
        "title": "Artist Reference",
        "question": "Name an artist more people should know about. What would you want someone hearing them for the first time to notice?",
        "profile_key": "artist_reference",
        "required": true
      },
      {
        "id": "recommendation",
        "title": "Recommendation",
        "question": "What's the last song you recommended, and why did you think it was worth sharing?",
        "profile_key": "recommendation",
        "required": true
      },
      {
        "id": "community_value",
        "title": "Community Value",
        "question": "Someone shares unfinished music that isn't really for you. How would you respond?",
        "profile_key": "community_value",
        "required": true
      },
      {
        "id": "participation_style",
        "title": "Participation Style",
        "question": "Which sounds most like you?",
        "profile_key": "participation_style",
        "required": true,
        "interaction": {
          "inputType": "singleSelect",
          "options": [
            "I mostly listen",
            "I like discussing music",
            "I enjoy giving feedback",
            "I regularly share discoveries"
          ]
        }
      },
      {
        "id": "forum_contribution",
        "title": "Forum Contribution",
        "question": "What's one thing you could realistically contribute in your first month?",
        "profile_key": "forum_contribution",
        "required": true
      }
    ]
  },
  "onboarding_experience": {
    "bridge_enabled": false,
    "followup_enabled": true,
    "boundary_enabled": false,
    "personalized_completion": false
  }
}
```

Use this only for static intake or after access has been granted. For selection, use the gatekeeper project above.

## Runtime Endpoints

Gatekeeper and onboarding both use:

```text
POST /v1/sessions/{sessionId}/messages
```

Onboarding additionally supports:

```text
POST /v1/sessions/{sessionId}/start
```

Use `/start` for onboarding so the first assistant message appears before the user's first reply.

Fetch session state with:

```text
GET /v1/sessions/{sessionId}
```

For passed gatekeeper sessions, capture access email with:

```text
POST /v1/sessions/{sessionId}/access
```

## Configuration Guidance

- Use separate projects for different user journeys, even inside the same organisation.
- Keep the application opener on the project, not buried in the persona prompt.
- Keep onboarding questions in `flow_config.steps`, not in the persona prompt.
- Link the right persona with `persona_id`; use one persona for application and another for onboarding when the tone or job differs.
- Issue separate API keys for test and live integrations.
- Use `session_mode: "dry-run"` until the host app is ready to act on outcomes.
