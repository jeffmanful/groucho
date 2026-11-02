# Personas

Current guide, reviewed 2 November 2026. For a new public demo, start with [demo persona creation](demo-persona-creation.md). [Ownership and versions](persona-ownership.md) defines who may use/edit each record.

## What a persona controls

| Runtime | Voice and behaviour | Completion data |
| --- | --- | --- |
| Public demos (`conversation_v1`) | Active database persona supplies character; registered code profile supplies facts, fields and choices | Named `details` and simulation completion; no extraction job |
| COLORS (`colors_forum`) | Code-defined COLORS prompt/brief through the shared-engine adapter | Separate private reviewer report, grounded profile and suitability pipeline |
| Standard gatekeeper | Accessible active database prompt plus its supported runtime contract | Advisory legacy outcome and configured completion/extraction |
| Onboarding | Persona tone around project-owned steps | Structured answers and optional extraction/completion |

A prompt does not select a runtime, deliver option buttons, approve an application or fulfil a reservation. Public-demo prompt authoring must not revive the retired pass/reject interview script.

## Records

`personas` stores identity (`id`, `name`, `slug`), `prompt`, active/default flags, ownership/visibility, version/source lineage and optional `profile_schema`/`profile_extractor_hint`. Pass/reject thresholds remain compatibility fields for the standard engine; they are not a public demo decision policy.

Groucho-owned originals are platform-managed. Organisation owners/admins may clone a visible original and edit their organisation's copy. Other organisations cannot use private copies. Project assignment must pass the same access rules as runtime resolution. See [ownership](persona-ownership.md) for visibility grants, snapshots, updates and permissions.

Public profiles require the resolved ID to equal `settings.persona_id`, so missing/inactive/inaccessible configuration does not silently switch character. Other flows retain their documented default fallback. Do not change the platform default to fix a single project.

## Creation and editing

Platform creation uses authenticated `POST /api/admin/personas`; organisation clone/edit routes live under `/api/admin/organisations/{orgId}/personas`. Use the admin workflow and the intended owner's permissions. Set a stable slug, concise character prompt and explicit project assignment. Leave `is_default` false unless intentionally changing platform-wide fallback.

For a public demo, register the matching backend profile and wire its website route/key as well as creating the persona record. The [creation guide](demo-persona-creation.md) supplies a complete example and test matrix. Prompt changes are resolved during message handling and can be cached; use new sessions when evaluating edits.

## Optional extracted profiles

`profile_schema` describes custom fields for the separate extraction pipeline, not live public-demo details. The schema root must declare `type: object` and object `properties`; property names must match `[A-Za-z_][A-Za-z0-9_]*`, and field definitions must be objects. Extractor hints are trimmed/capped at 2,000 characters. Use `x-pii: true` for fields requiring masking in supported admin views; it is not permission to collect unnecessary personal data.

See [profile schema guide](profile-schema-guide.md) for extraction scope and limits. Final decisions are controlled by [project policy](client-decision-policy.md), never persona threshold fields alone.

## Retirement

Prefer deactivation over deleting referenced records. The delete route rejects a persona referenced by sessions. Preserve historical ownership/version evidence, and move affected projects to another authorised active persona before deactivation. Re-test each affected runtime; a COLORS code prompt and a public-demo database prompt have different update paths.
