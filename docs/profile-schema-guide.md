# Authoring an extracted profile schema

Current guide, reviewed 2 November 2026. This is the separate extracted-profile contract, not the public demos' live named `details`. See [runtime map](architecture.md).

## Which flow extracts

| Flow | Extraction |
| --- | --- |
| Standard gatekeeper | Configured terminal passed/redirected/rejected statuses; extraction runs after closing |
| Onboarding | Off by default; explicitly configured extraction can use step keys/schema |
| Newer COLORS | Its separate assessment pipeline generates/grounds a profile from persisted evidence |
| Public `conversation_v1` simulations | No extraction/completion job; profile fields do not populate the live note |

`profile_extract_on` controls the standard verdict path, not a universal off-switch for the newer COLORS pipeline. For standard flows, `false`/`null` disables, an array selects terminal statuses, and unset gatekeeper settings default to passed/redirected/rejected. Onboarding defaults to no extraction. See `lib/verdict-webhook.ts` and `lib/session-completion-jobs.ts`.

## Shape and authoring

Profiles have platform-versioned `core`, persona-defined `custom`, and extraction status/model metadata. A failed extraction is not a valid empty success; check `extraction.status`. Full shape: [profile schema](profile-payload.schema.json).

Edit a persona you are authorised to manage through the admin workflow. `profile_schema` accepts this JSON Schema-like shape:

```json
{
  "type": "object",
  "properties": {
    "intent": { "type": "string", "description": "The visitor's stated purpose; do not infer an unstated motive." },
    "contact": { "type": "string", "description": "Contact information volunteered in the transcript, if relevant.", "x-pii": true }
  }
}
```

The root/object/property-name checks are implemented in `lib/persona-profile-schema.ts`. Names match `[A-Za-z_][A-Za-z0-9_]*`; field definitions must be objects. This is not full JSON Schema meta-validation. Unknown extracted custom keys are dropped, but arbitrary declared custom values are not comprehensively type/coercion/size validated. Do not promise a per-field 1KB enforcement that the implementation does not provide.

Keep fields small and concrete, use descriptions and a concise `profile_extractor_hint` (trimmed/capped at 2,000 characters). Missing evidence stays unknown rather than invented. Custom schema edits affect future extraction, not a migration of old stored profiles. Persona versions preserve content history separately from `schema_version: 1` on the profile payload.

## Personal information and limits

`x-pii: true` marks custom fields for masking/reveal in supported authorised admin views. It does not itself redact every export, webhook or custom value. Core summary and QA text are normalised/redacted for supported email/phone patterns; that is not a complete sensitive-data detector. Minimise collection and keep private fields out of applicant relays.

`lib/profile-extraction.ts` owns model selection/normalisation. At this review the generic extraction call uses a 2,048-token output budget; core summary is capped at 280 characters, intent tags at five and interests at ten. Logs should contain extraction metadata/key summaries, not raw private values. Model budget and schema hints are not semantic proof of accuracy.

## Retrieval and recovery

Immediate conversation responses may precede extraction. Read authorised persisted session/reviewer data after completion, or consume the subscribed signed completion webhook. The shared engine's immediate `profile` string is a runtime profile ID, not this extracted object.

For standard missing-profile recovery, first preview the backfill:

```bash
pnpm run backfill:session-profiles -- --project=<slug-or-uuid> --since=<ISO-date> --dry-run
```

Review the scope/side effects before the corresponding write run. The script reuses compatible stored verdict profiles before model calls and does not overwrite an existing session profile. Newer COLORS assessments have their own admin recovery path; public simulations should not be queued into either pipeline merely to produce a sidebar note.
