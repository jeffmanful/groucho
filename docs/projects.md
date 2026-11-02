# Projects

Current configuration guide, reviewed 2 November 2026. A project belongs to one organisation and scopes settings, API keys, sessions, integrations and review/allocation. See [architecture](architecture.md) before selecting a flow.

## Types and engines

`settings.project_type` supports `gatekeeper`, `onboarding` and `ticket_access`; absent/invalid values parse as gatekeeper. Form-only drop entries are an entry/review route, not an additional conversation engine.

| Configuration | Behaviour |
| --- | --- |
| Gatekeeper + `conversation_engine: conversation_v1` and registered `conversation_profile` | Shared public-demo runtime, named fields/options and simulation completion |
| Gatekeeper + `conversation_engine: colors_forum` | Newer COLORS conversation and separate assessment pipeline |
| Gatekeeper without either setting | Supported standard gatekeeper and its legacy advisory terminal outcomes |
| Onboarding + `flow_config.steps` | Ordered configured intake, optional follow-ups/LLM features |
| Ticket access | Isolated synthetic operator workspace; settings forced test/dry-run |

Profile IDs, metadata markers, models and `project_type` are different concepts. A persona assignment alone does not select a newer engine. See [shared engine](reusable-conversation-engine.md) and [COLORS engine](colors-conversation-engine.md) for exact settings and compatibility.

## Common settings

```json
{
  "project_type": "gatekeeper",
  "use_case": "community_gate",
  "environment": "test",
  "session_mode": "dry-run",
  "persona_id": "<active-accessible-persona-uuid>",
  "decision_policy": {
    "automatic_acceptance_enabled": false,
    "automatic_decline_enabled": false,
    "acceptance_threshold": 0.8,
    "review_threshold": 0.55
  }
}
```

`environment`/`session_mode` do not replace the runtime's explicit simulation contract. Do not describe dry-run as a universal guarantee that every possible side effect is disabled; verify the selected flow. Merge edits without dropping unknown settings. Project/persona resolution may be cached per process for about a minute.

## Experience and persona

`application_experience` supports opening/closing copy, opening interactions, evidence-signal definitions, preferred inputs and a soft turn target. Standard gatekeeper uses its structured outcome contract; newer COLORS uses its code prompt and shared conversational contract. Public demo profiles define their own objective, opening, closing, required fields and options, overriding incompatible request/project openers. Align display settings with the registered profile.

For real applications, endings are neutral: do not expose a private recommendation or promise acceptance. `completed`, `passed`, `redirected` and `rejected` are conversation states, not approval. The [client decision policy](client-decision-policy.md) owns independent thresholds and automatic switches, both off by default. Turn limits differ by runtime; the old nine-question/two-follow-up recipe is not a universal current engine guarantee.

`persona_id` must reference an active persona the organisation may use. [Ownership](persona-ownership.md) governs original/clone access. Public demo adapters reject an unavailable exact persona instead of substituting a default. See [persona creation](demo-persona-creation.md) for adding a profile.

## Onboarding

Define ordered `flow_config.steps` rather than embedding a script in the persona. Input types and validation follow `lib/project-settings.ts` and the interaction schema. Onboarding experience can enable heuristic follow-up, LLM bridging/boundary handling or personalised completion; these are opt-ins. Completion is `passed` after configured steps, not a suitability assessment.

The standard `profile_extract_on` setting controls extraction for passed/redirected/rejected paths. Onboarding defaults to no extraction; standard gatekeeper defaults to its configured terminal statuses. Public simulations suppress completion jobs, and COLORS' newer assessment pipeline supplies its own grounded profile; do not treat this setting as a universal switch for every flow. See [profile schemas](profile-schema-guide.md).

## Keys, webhooks and invitations

- Create project keys in the authenticated project integration controls. Secret material is shown once; store it server-side. Use conversations scope for applicant relays and applications scope only for authorised server review.
- Webhooks have signing secrets, explicit event subscriptions and delivery/retry state. Verify raw-body HMAC; do not infer a later decision/allocation from `session.completed` alone.
- Application invitations are an opt-in capability for a specific real application project, distinct from organisation/admin invites. They fix the assigned session/recipient/audience; see [COLORS invitation pilot](colors-admin-pilot.md).
- Cohorts can require allocation in addition to approval before access is usable. See [review/allocation](client-decision-workspace.md).

## Runtime endpoints

Use `POST /v1/sessions/{id}/start` to show an opening before the first reply, `POST /messages` for turns, and `GET /v1/sessions/{id}` for permitted state reads. A start/resume is not a token-issuance endpoint. Old or concluded sessions may need a fresh attempt; preserve ownership and invitation rules.

`POST /v1/sessions/{id}/access` requires a recorded approval and its matching secret (plus allocation entitlement where applicable), not merely `status: passed`. Public simulations issue no such secret.

See [OpenAPI](api/openapi.yaml), [client integration](client-integration-guide.md), [project creation](platform-project-wizard.md) and the [ticket simulation guide](../pilots/ticket-access-simulation.md). Production readiness requires deployed end-to-end checks, not just a saved project.
