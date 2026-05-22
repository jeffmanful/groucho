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
- Use per-turn scores and persona thresholds.
- Can return a `secret` when passed for downstream access capture.

### Onboarding Projects

Onboarding projects are structured intake flows.

They:

- Use `flow_config.steps` as the source of truth.
- Bootstrap the first assistant message with `POST /v1/sessions/{id}/start`.
- Advance through fixed steps in order.
- Can ask one follow-up per step when enabled.
- Can issue boundary responses when enabled.
- Complete as `passed` after the final configured step.
- Extract a profile using the onboarding step keys and persona schema.

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
- `pass_threshold` - Used by gatekeeper terminal normalization.
- `reject_threshold` - Used by gatekeeper terminal normalization.
- `profile_extract_on` - Optional profile extraction control. Defaults to all terminal statuses. Use `["passed"]` to extract only on passes, or `false` / `null` to disable extraction.

## Gatekeeper Configuration

Gatekeeper projects can configure the initial assistant message:

```json
{
  "project_type": "gatekeeper",
  "persona_id": "11111111-1111-1111-1111-111111111111",
  "application_experience": {
    "opening_message": "Welcome. A few questions first.\n\nWe are looking for people who understand care, creativity, and community beyond access."
  },
  "pass_threshold": 0.65,
  "reject_threshold": 0.25
}
```

If `application_experience.opening_message` is missing or empty, Groucho uses:

```text
Hi.
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
    "bridge_enabled": true,
    "followup_enabled": true,
    "boundary_enabled": true,
    "personalized_completion": true
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
- `followup_prompt` - Optional custom follow-up if an answer is brief or vague.
- `min_answer_chars` - Optional heuristic threshold for follow-up prompts. Defaults to 24.

`onboarding_experience` fields:

- `bridge_enabled` - Allows short persona-voiced acknowledgements between steps.
- `followup_enabled` - Allows one clarifying follow-up per step.
- `boundary_enabled` - Allows calm pushback when answers undermine dignity or safety.
- `personalized_completion` - Generates a short personalized closing after the final answer. When disabled, Groucho uses the default closing.

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
    "opening_message": "Welcome. A few questions first.\n\nWe are looking for people who understand care, creativity, and community beyond access."
  },
  "pass_threshold": 0.65,
  "reject_threshold": 0.25,
  "profile_extract_on": ["passed", "redirected", "rejected"]
}
```

Use this when the user is applying for access and Groucho should make a decision.

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
        "question": "What draws you to COLORS, beyond discovering new music?",
        "profile_key": "intent",
        "required": true
      },
      {
        "id": "belonging",
        "title": "Belonging",
        "question": "What helps you feel safe, respected, and able to show up as yourself?",
        "profile_key": "belonging",
        "required": true
      },
      {
        "id": "contribution",
        "title": "Contribution",
        "question": "How would you want to contribute to the COLORS world without adding noise?",
        "profile_key": "contribution",
        "required": true
      }
    ]
  },
  "onboarding_experience": {
    "bridge_enabled": true,
    "followup_enabled": true,
    "boundary_enabled": true,
    "personalized_completion": true
  },
  "profile_extract_on": ["passed"]
}
```

Use this after access has been granted, or when the product goal is structured onboarding rather than selection.

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
