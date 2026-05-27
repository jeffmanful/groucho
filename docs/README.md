# Groucho documentation index

| Document | Description |
|----------|-------------|
| [PRD.md](./PRD.md) | v1.1 product requirements (gatekeeper + onboarding flows, structured `profile`), personas, FR/NFR, acceptance criteria |
| [adr/0001-api-key-and-client-access.md](./adr/0001-api-key-and-client-access.md) | ADR: where API keys may run (browser vs server) |
| [database-setup.md](./database-setup.md) | Local or hosted Supabase + env vars for the team |
| [schema-migration.md](./schema-migration.md) | Current Supabase schema → v1 tables + RLS matrix |
| [organisations.md](./organisations.md) | How organisations, members, invitations, and org-level access work |
| [personas.md](./personas.md) | How personas drive tone, decisions, thresholds, and profile extraction |
| [projects.md](./projects.md) | How projects configure gatekeeper and onboarding flows, keys, and webhooks |
| [client-integration-guide.md](./client-integration-guide.md) | Host app integration pattern: multiple Groucho projects, explicit session IDs, SDK mounts, and webhook-driven decisions |
| [platform-project-wizard.md](./platform-project-wizard.md) | Multi-step project creation epic |
| [api/openapi.yaml](./api/openapi.yaml) | Public Project HTTP API (sessions / messages / access) |
| [sdk-surface.md](./sdk-surface.md) | `@groucho/sdk` exports and React API |
| [roadmap-github-issues.md](./roadmap-github-issues.md) | Phased issues for GitHub or Linear |

Product prompts live under [../prompts/](../prompts/).
