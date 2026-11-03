# Ticket-access simulation

Current sandbox guide, reviewed 2 November 2026. This synthetic operator workflow demonstrates registrations, suspicious clusters, review and ballot/allocation. It is not a ticket provider, identity verification service or live customer deployment.

Protected demo pages include `/demos/ticket-access` and `/demos/consumer-drop`; authenticated admin entry points and `ticket_access` project setup provide related isolated simulations. Demo testers do not gain platform-admin rights. `lib/consumer-drop-demo.ts`, the ticket-access demo components and their tests define fixture behaviour. Fictional/synthetic labels must remain visible.

A ticket-access simulation project is forced to test/dry-run settings and does not require a persona or live project API key. Synthetic activity must not be described as persisted real applications, real inventory, provider fraud findings or ticket allocations. Demo reset/refresh behaviour differs from the platform's real entry/cohort APIs.

## Rehearsal

1. Sign in through an authorised demo/admin path; verify a tester cannot reach unrelated admin resources.
2. Inspect synthetic entries and possible duplicate/cluster signals. Treat flags as review clues, not proof of fraud.
3. Rehearse review, selecting the intended pool and drawing the illustrated allocation.
4. Check stock/group counts, reset and failure/empty states for the scenario in use.
5. Explain what is simulated, what is saved, what would need a real provider integration and who would fulfil the result.

Real form entries, decision corrections, cohorts and signed allocation events are separately documented in [review/allocation](../docs/client-decision-workspace.md) and [client integration](../docs/client-integration-guide.md). Do not infer that a synthetic button exercises those production paths. Past meeting/implementation notes remain in the [archive](../docs/archive/README.md).
