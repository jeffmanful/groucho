# Groucho overview

Current entry point, reviewed 2 November 2026. This replaces the older universal-scoring/terminal-outcome overview; operational details have one owner in the guides below.

Groucho provides a multi-tenant platform/API and the `@groucho-gatekeeper/sdk` source package. It can run a conversation, prepare an assessment where configured, record client decisions and allocation, and deliver subscribed signed events. Client products own accounts, audience communication and fulfilment. Public persona demos are explicit simulations with no real assessment/approval/allocation promise.

- [Architecture/runtime map](docs/architecture.md): public demos, COLORS, standard gatekeeper, onboarding and ticket-access sandbox.
- [Documentation index](docs/README.md): current integration, configuration and operations.
- [Shared engine](docs/reusable-conversation-engine.md) and [new persona creation](docs/demo-persona-creation.md).
- [Client decision policy](docs/client-decision-policy.md) and [review/allocation](docs/client-decision-workspace.md).
- [SDK source/adoption](docs/sdk-surface.md) and [database setup](docs/database-setup.md).
- [Proposals](pilots/README.md) and [historical evidence](docs/archive/README.md), separated from shipped behaviour.

A build, deployment, applied migration and published consumer SDK are different states. Verify the intended environment rather than treating an old readiness snapshot as today's guarantee. The [root README](README.md) contains development commands.
