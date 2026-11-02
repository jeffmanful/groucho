# Review, decisions and allocation

Current implementation guide, reviewed 2 November 2026. Source authority: application review routes, `lib/decision-ledger.ts`, decision/correction functions, `lib/entry-review.ts`, `lib/cohorts.ts` and migrations. This replaces the mixed implementation/product-direction document.

## Distinct stages

Groucho records conversations, assessments, decisions and allocation history. The client owns audience communication, accounts, invitations and real fulfilment. Public persona demos stop before this workflow; they do not submit a real application or create a pending assessment job.

- **Assessment:** evidence-backed report and suitability; not an access decision.
- **Decision:** approved/declined by an authorised reviewer, server integration or enabled deterministic policy.
- **Allocation:** place approved people into cohorts when the project uses them.
- **Fulfilment:** the host product acts on the authorised result and reports later outcomes.

## Review and corrections

Organisation members can read accessible applications; owner/admin permissions control writes. Applications-scoped API keys support trusted server integrations. A browser relay must not expose review/decision routes. The client server is responsible for authenticating the reviewer identity it supplies.

The first concurrent decision wins. Corrections require an explicit reason and the decision being replaced; a new decision supersedes the old one atomically. Old rows remain in the audit history. There is at most one current decision for a decided session; applications awaiting review have none. Do not describe decisions as mutable rows or as one immutable decision forever with no correction path.

`reviewStatus`, not a legacy outcome or score alone, is the decision state. An approval's matching access secret is required by the access endpoint. Correcting to decline invalidates approved access; a subsequent approved correction has its own current authority. See [decision policy](client-decision-policy.md).

## Entries, cohorts and ballots

Form-only entries are supported by `POST /v1/entries`; not every entry has an AI conversation. Entry review includes field filters and possible duplicate email/phone/social signals. Flags support review; they are not proof of fraud.

Cohorts group approved people, with access-granting status, optional capacity, lock/order/rules and audited membership moves. When a project uses cohorts, membership in an access-granting cohort is required for access; approval alone is insufficient. A project's current allocation round is created when cohorts are used. The current implementation does not provide a complete multi-round lifecycle/entry-window management product.

Supported operations include manual placement, filtered/score-based fills and secure random draw without replacement, with recorded inputs and movement history. External draws can report selected members through the server API. Inspect `lib/cohorts.ts` and the admin/API permissions before operating real allocations.

Signed events include `session.completed`, `application.decided`, `application.decision_corrected`, `application.allocated` and reported-outcome events supported by `lib/webhook-events.ts`. Subscribe explicitly to the events the host needs; a completion event alone does not announce every later correction/allocation. Verify raw-body HMAC and deduplicate delivery IDs.

## Remaining product direction

The rotating fan-evidence question bank and optional provider connections are [proposals](../pilots/fan-evidence-and-question-bank.md), not current reviewer signals. Clarification-request workflows, reapplication cooldowns, full rule simulation and broader Insights/round lifecycle should not be promised from earlier mockups. Verify a specific feature in the current implementation and deployment before describing it as available.

For integration examples use [client integration](client-integration-guide.md) and [SDK surface](sdk-surface.md). [Pilot plans](../pilots/README.md) remain separately labelled research/simulations.
