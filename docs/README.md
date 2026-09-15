# Groucho documentation index

| Document | Description |
|----------|-------------|
| [groucho-state-of-play-2026-08-20.md](./groucho-state-of-play-2026-08-20.md) | Historical end-of-day COLORS status and verification snapshot; its human-only decision boundary is superseded |
| [groucho-latency-improvements-2026-08-21.md](./groucho-latency-improvements-2026-08-21.md) | Implemented response-time architecture, operational requirements, measurements, and retained quality safeguards |
| [PRD.md](./PRD.md) | v1.1 product requirements (gatekeeper + onboarding flows, structured `profile`), personas, FR/NFR, acceptance criteria |
| [adr/0001-api-key-and-client-access.md](./adr/0001-api-key-and-client-access.md) | ADR: where API keys may run (browser vs server) |
| [database-setup.md](./database-setup.md) | Local or hosted Supabase + env vars for the team |
| [schema-migration.md](./schema-migration.md) | Current Supabase schema → v1 tables + RLS matrix |
| [client-decision-policy.md](./client-decision-policy.md) | Authoritative suitability bands, automatic acceptance/decline settings, audit records, and access rules |
| [organisations.md](./organisations.md) | How organisations, members, invitations, and org-level access work |
| [personas.md](./personas.md) | How personas drive tone, decisions, thresholds, and profile extraction |
| [projects.md](./projects.md) | How projects configure gatekeeper and onboarding flows, keys, and webhooks |
| [client-integration-guide.md](./client-integration-guide.md) | Host app integration pattern: multiple Groucho projects, explicit session IDs, SDK mounts, and webhook-driven decisions |
| [platform-project-wizard.md](./platform-project-wizard.md) | Multi-step project creation epic |
| [api/openapi.yaml](./api/openapi.yaml) | Public Project HTTP API (sessions / messages / access) |
| [sdk-surface.md](./sdk-surface.md) | `@groucho/sdk` exports and React API |
| [v2-roadmap.md](./v2-roadmap.md) | V2 gatekeeper-first product direction and refactor roadmap |
| [groucho-stronger-v1-implementation-plan.md](./groucho-stronger-v1-implementation-plan.md) | Historical implementation plan for authoritative state, evidence provenance, the original human-only decision boundary, and fairness evaluation; see the current decision-policy guide |
| [colors-flexible-conversation-contract.md](./colors-flexible-conversation-contract.md) | Firm evidence intents, flexible question generation, opening-answer routing, and soft pacing for the COLORS flow |
| [current-functionality-and-coverage-audit-2026-08-20.md](./current-functionality-and-coverage-audit-2026-08-20.md) | Active runtime map, automated coverage, completed cleanup, and remaining production gaps |
| [colors-application-improvements.md](./colors-application-improvements.md) | COLORS application content, performance, acceptance criteria, and implementation tracker |
| [colors-cultural-signals.md](./colors-cultural-signals.md) | Five-phase plan and privacy boundaries for project-level cultural memory |
| [colors-conversation-realism.md](./colors-conversation-realism.md) | Eight-layer roadmap for making Groucho feel like an attentive conversation rather than an interview |
| [colors-conversation-guide-and-rubric.md](./colors-conversation-guide-and-rubric.md) | Authoritative standard for the COLORS Groucho experience, transcript-quality scoring, critical failures, and reviewer calibration |
| [colors-curation-question-experiment.md](./colors-curation-question-experiment.md) | COLORS-specific rich question catalogue, media-choice interaction requirements, and control-versus-curation-pilot test design |
| [media-choice-interactions.md](./media-choice-interactions.md) | Production contract and integration guide for video-backed select, remove, rank, rationale, and structured-answer interactions |
| [colors-evaluation-rubric-discovery.md](./colors-evaluation-rubric-discovery.md) | COLORS rubric discovery questions, needed client examples, and confirmed Groucho rules |
| [roadmap-github-issues.md](./roadmap-github-issues.md) | Phased issues for GitHub or Linear |

Product prompts live under [../prompts/](../prompts/).
