# Fi demo: implementation and rehearsal

Implemented 16 October 2026 as the first simulation slice of the
[demo plan](./fi-demo-2026-10-23.md).

## Open it

- Sign in with an existing platform or organisation-member account.
- Choose **Ticket access demo** in the admin navigation for the standalone sandbox.
- To save a project identity, use **New project**, choose an organisation, enter
  the project name/slug and select **Ticket access (synthetic demo)**. Continue
  and create the demo project. Open it later from the overview's **Open ticket
  workspace** link or its edit page.
- The route is `/admin/ticket-access`, with optional `project` and `org` IDs for
  an authorised saved project. Both the route and project lookup enforce access.

The new `ticket_access` type is stored in the existing project's settings JSON;
no schema migration is needed. It is forced to test/dry-run mode, drops live
integrations, and is excluded from the conversation playground. Session start and
message services reject ticket-access projects. Existing login is reused; no new
accounts are provisioned by this work.

## Rehearse

1. Inspect the seeded cluster at Eden Shaw. Search `listener48` or use unresolved
   flags to inspect the four related fixture records.
2. Open Jordan Lee to show a private-profile/new-fan case with a phone alternative
   that remains eligible.
3. Open Jules Ward, record a reason and hold the repeated Instagram identifier.
   Alex Morgan becomes eligible when the conflict is resolved.
4. Clear Remy Cole's weak flag with a reason. Filtering alone never excludes
   anyone. Confirming eligibility cannot override incomplete checks or shared IDs.
5. In Event setup, change the welcome; save and show it in Fan preview.
6. Register a fictional listener, simulate email and either account-control route,
   optionally answer the two scripted prompts, and return to their dashboard card.
7. Preview Allocation, inspect exclusions, freeze the cohort and draw. Six distinct
   eligible registrations receive simulated purchase opportunities; the remainder
   appear on a ranked waitlist. The draw cannot run twice.
8. Reset explicitly to begin a fresh run.

## Deliberate limits

All people, signals, provider outcomes and fan history are synthetic. The welcome
conversation is explicitly scripted, with no LLM requests or humanity assessment.
The result includes illustrative DEMO references, not redeemable entitlements.
Nothing sends email/SMS, accesses Instagram/World ID, issues tickets or processes
payments. No ticketing or identity-provider secrets are required.

The project identity persists in the normal database. Event edits, reviews,
registrations and draws exist only in React state on the current page. Refresh,
navigation away or a new browser tab starts again; this is stated in the banner.
There is no multi-user shared ledger, durable audit or production authorisation
boundary in the demo model. All signed-in users can operate their own standalone
synthetic sandbox; a saved project workspace requires organisation membership.

The shuffle uses browser cryptographic randomness and selection without
replacement. Frozen input and result are visible, but this is not independently
verifiable lottery infrastructure. Universal unique-person enforcement, approved
provider integrations, durable data and real entitlements are later work.

## Verification record

Focused model/settings tests cover duplicate exclusion, private-profile
alternatives, incomplete checks, frozen inputs, once-only allocation, invalid draw
orders and forced simulation settings. All 46 focused tests and type checking passed. Browser rehearsal
covered fan registration with phone alternative, reviewer action, freeze and draw,
reset, configuration changes, filtering and the mobile layout. The project wizard
was checked through the dedicated setup screen; no project was saved during the
browser rehearsal.

The wider suite reported two failures in cultural-signal extraction caused by a
`log.warn` mock mismatch in the pre-existing LLM-usage work. Existing effect lint
errors remain in the admin layout and project wizard/edit pages; the new demo
files pass lint. This record does not claim those unrelated failures were fixed.
