# Authoring a persona profile schema

Groucho extracts a structured profile every time a session reaches a terminal outcome
(`passed`, `redirected`, or `rejected`). The payload has two halves:

- **`core`** — platform-versioned fields you always get (`summary`, `sentiment`,
  `engagement`, `language`, `intent_tags`, `interests`, `risk_flags`, `qa`, `confidence`).
- **`custom`** — brand-defined fields you declare per persona via `profile_schema`.

This guide explains how to author the `custom` half.

## Where to set it

In **Admin → Personas → edit**:

- **Profile schema (JSON)** — paste a JSON Schema fragment.
- **Extractor hint** — a short natural-language instruction that gets appended to the
  extractor's system prompt. Keep it under ~200 chars.

Both are optional. Leave them blank to get only the `core` profile.

## Shape

We accept a **JSON Schema-like** object:

```json
{
  "type": "object",
  "properties": {
    "<field>": {
      "type": "string" | "number" | "integer" | "boolean" | "array",
      "description": "Short hint shown to the extractor — be specific.",
      "x-pii": true
    }
  }
}
```

Rules:

- The root must be `{ "type": "object", "properties": { ... } }`.
- Property names must match `[A-Za-z_][A-Za-z0-9_]*`.
- **Anything outside `properties` is ignored.** Unknown LLM keys are silently dropped.
- `description` is the **most important** field — the extractor reads it to know what
  to look for.

## The `x-pii` convention

Add `"x-pii": true` to any field that may contain personal data:

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "x-pii": true },
    "email": { "type": "string", "x-pii": true },
    "age_band": { "type": "string", "description": "25-34" }
  }
}
```

This does three things:

1. The admin **session profile panel** masks the value (`••••••`) and gates a
   **Reveal** button behind the `requireOrgAdmin` role.
2. The structured logger redacts the value (only `field_name` is ever logged).
3. The PII convention is forward-compatible with future Groucho features (PII export
   filters, RTBF wipes).

`core.summary` and `core.qa[*].answer` are **always** auto-redacted for email and
E.164-shaped phone numbers, regardless of any schema settings.

## Example: club / venue door

```json
{
  "type": "object",
  "properties": {
    "previously_attended": {
      "type": "boolean",
      "description": "Has the applicant attended this venue before? true/false."
    },
    "referral_source": {
      "type": "string",
      "description": "How did they hear about us? friend / press / social / other."
    },
    "community_link": {
      "type": "string",
      "description": "Names of communities, collectives, or scenes they reference."
    },
    "contact": {
      "type": "string",
      "x-pii": true,
      "description": "Any email or phone the applicant volunteers (do not solicit)."
    }
  }
}
```

Extractor hint suggestion:

> Lean on direct quotes for `referral_source`. Leave `previously_attended` empty if
> not stated.

## Example: SaaS onboarding

```json
{
  "type": "object",
  "properties": {
    "team_size": {
      "type": "string",
      "description": "Rough team size band: 1, 2-10, 11-50, 51-200, 200+."
    },
    "use_case": {
      "type": "string",
      "description": "1 sentence describing what they want to build with the product."
    },
    "blockers": {
      "type": "array",
      "description": "Top 1-3 reasons they would not adopt (price, integrations, etc.)."
    }
  }
}
```

## Versioning

Today only `core` is versioned (`schema_version: 1`). The shape of `custom` is owned
by *you* — if you change `profile_schema`, future sessions will reflect the new
shape. Existing verdict rows are not migrated.

## Limits

- Each field's value is clamped at ~1KB by the extractor's JSON budget.
- `core.summary` ≤ 280 chars; `core.intent_tags` ≤ 5; `core.interests` ≤ 10.
- The extractor defaults to `claude-haiku-4-5-20251001` with `max_tokens: 1024` to
  keep terminal-session costs low. Set `GROUCHO_PROFILE_EXTRACTION_MODEL` only
  when evals show a larger model materially improves extraction quality.
- Aim for ≤ 10 custom fields; more is allowed but extraction quality degrades.
- Successful extraction calls emit an `llm_usage` structured log event with token
  counts and `estimatedCostUsd` when pricing is known for the configured model.

## Disabling extraction

Per project: set `projects.settings.profile_extract_on` to either:

- `false` or `null` — disable extraction entirely, or
- An array of statuses to run on, e.g. `["passed"]`.

Default (when unset): `["passed", "redirected", "rejected"]`.

## Consuming the profile

- **Webhook** — `payload.profile` on `session.completed`.
- **REST** — `GET /v1/sessions/{sessionId}` returns `profile` once concluded.
- **SDK** — `<Gatekeeper onOutcome={(outcome, { scores, profile }) => ...} />`.
