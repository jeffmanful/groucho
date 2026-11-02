# Groucho documentation

Current guidance reviewed against repository source on 2 November 2026. Begin with the runtime map; a completed conversation is not necessarily an assessment, approval or allocation.

## Start here

| Guide | Use it for |
| --- | --- |
| [Architecture and runtime map](architecture.md) | Choosing a flow and understanding conversation, assessment, decision and fulfilment boundaries |
| [Shared conversation engine](reusable-conversation-engine.md) | COLORS runtime extraction, public demo contracts, rollout, recovery and verification |
| [Creating a demo persona](demo-persona-creation.md) | Character briefs, profiles, fields, choices and adding another demo |
| [Client integration](client-integration-guide.md) | Server relays, identity, keys, sessions, decisions and webhooks |
| [SDK surface](sdk-surface.md) | Actual package name, source entry points and version adoption |

## Configuration and operations

- [Projects](projects.md), [project creation](platform-project-wizard.md), [organisations](organisations.md).
- [Personas](personas.md), [ownership and versions](persona-ownership.md), [profile schemas](profile-schema-guide.md).
- [Authentication](authentication.md), [dashboard access](admin-access.md), [API-key ADR](adr/0001-api-key-and-client-access.md).
- [Database setup](database-setup.md), [schema map](database-schema.md), [retention and recovery](backup-retention.md), [security review](security-review-checklist.md).
- [Decision policy](client-decision-policy.md), [review and allocation workspace](client-decision-workspace.md).

## COLORS and interactions

- [COLORS engine and completion](colors-conversation-engine.md).
- [Invitation-only Forum pilot](colors-admin-pilot.md) and [protected reviewer demo](colors-forum-demo.md): distinct experiences with distinct permissions.
- [Community/artist intake](artist-forum-application.md), [membership brief](colors-forum-membership-brief.md), [conversation quality rubric](colors-conversation-guide-and-rubric.md).
- [Rich media interactions](media-choice-interactions.md) and [aggregate cultural signals](colors-cultural-signals.md).

## Contracts, proposals and evidence

- [OpenAPI](api/openapi.yaml), [profile schema](profile-payload.schema.json), [completion webhook schema](event-payload-session-completed.schema.json).
- [SDK README](../packages/sdk/README.md) and [Next.js example](../examples/next-groucho/README.md).
- [Pilot proposals and simulations](../pilots/README.md) are not launch commitments or current integration instructions.
- [Historical evidence and removal map](archive/README.md). Dated replay JSON remains under `docs/replays` for evaluation tooling.
- [Documentation maintenance rules](documentation-policy.md).

The public demo website is a separate [groucho-demos repository](https://github.com/thompson-mcdonald/groucho-demos). Its README and `docs` cover branded pages and the browser controller. Old build prompts and overlapping controller specifications have been removed; Git history retains them.
