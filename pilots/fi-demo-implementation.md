# Fi demo: implementation and rehearsal

Implemented 16 October 2026 as the first simulation slice of the
[demo plan](./fi-demo-2026-10-23.md).

## Current scope and next presentation task

The 16 October follow-up discussion changes the presentation priority to
**suspicious clusters → applicant review → fair ballot**, using an illustrative
Ezra Collective scenario. The current seed still says “Example Artist · intimate
show”; Ezra framing is planned, not yet implemented. Keep 24 synthetic entries,
six purchase opportunities and the existing fixture cases. No artist-approved
inventory or relationship is implied. Follow the revised [meeting plan](./fi-demo-2026-10-23.md).

## Open it

- The main entrance defaults to admin sign-in. Sign in with an existing platform
  or organisation-member account for the admin workspace.
- **Access public demos** opens `/demos`, which requires a separate demo tester
  login. Its chooser opens `/demos/ticket-access` or the existing COLORS demo.
  Admin login does not bypass demo login; demo login does not grant admin access.
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
5. Optional after the core operator walkthrough: in Event setup, change the welcome; save and show it in Fan preview.
6. Optional fan journey: register a fictional listener, simulate email and either account-control route,
   optionally answer the two scripted prompts, and return to their dashboard card.
7. Preview Allocation, inspect exclusions, freeze the cohort and draw. Six distinct
   eligible registrations receive simulated purchase opportunities; the remainder
   appear on a ranked waitlist. The draw cannot run twice.
8. Reset explicitly to begin a fresh run.

For Friday, present steps 1–4 followed by 7–8. Keep fan registration/configuration
as optional supporting screens. Inspect what the cluster actually shows; do not
invent submission timings or other telemetry. A held cluster is unresolved risk,
not a finding that its members are bots. Explain the equal-chance policy and the
exclusions before freezing. The result is a simulated opportunity and waitlist,
with an export/partner handoff to validate with Fi, not an implemented checkout.

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

The subsequent main-branch merge on 16 October passed all 478 tests and a
production build. It updated the obsolete root-routing test and the `log.warn`
mock. Those checks validate the merged code, not an Ezra-specific browser rehearsal
or production anti-abuse efficacy. Existing effect lint findings noted in the
initial implementation were not addressed by these documentation updates.
