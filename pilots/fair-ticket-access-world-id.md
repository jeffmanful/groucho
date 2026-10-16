# Fair ticket access with Groucho and World ID

**Status:** proposed pilot; no integration implemented or partner agreed.
**Recorded:** 14 October 2026.
**Working proposition:** help artists get tickets into more people's hands by
limiting duplicate identities, removing speed advantages and reducing resale
profit, while giving buyers an artist-led welcome through Groucho.

## Problem and hypothesis

High-demand ticket sales reward speed, account volume and the ability to acquire
inventory for resale. Artists want live experiences to remain accessible to
listeners rather than being captured by operators with purchasing infrastructure.

The hypothesis is that unique-human registration, a lottery and enforced ticket
limits can reduce mass acquisition. Controlled transfers and face-value resale
could then reduce the incentive to acquire tickets speculatively. Groucho could
make registration feel like entering an artist's community and provide useful
context for separately curated allocations.

This is a hypothesis to test, not a claim that the combination eliminates bots or
scalping. A verified human can be a scalper, employ automation or act for someone
else. Proof of humanity does not prove honest intent, fandom or manual checkout.

## Responsibilities

| Component | Responsibility | Boundary |
| --- | --- | --- |
| World ID | Supply cryptographic evidence of humanity and uniqueness in a defined application/action context | Does not decide ticket eligibility or enforce our inventory ledger |
| Groucho | Artist-specific conversation, structured profile and optional reviewed application decisions | Is not a reliable bot detector or a cryptographic identity service |
| Pilot host/backend | Bind verified registration to the buyer, prevent duplicates, allocate and issue purchase entitlements | Must enforce policy independently of browser callbacks and model output |
| Ticketing partner | Inventory, payments, ticket issuance, ownership, transfer, resale and entry | Protection is incomplete if a bypass sale or unrestricted transfer remains available |
| Artist/promoter | Define allocation, quantity limits, pricing, exceptions and community experience | Owns policy and the tradeoff between access, friction and abuse resistance |

No blockchain-based ticket or cryptocurrency payment is required by this proposed
product. Use World ID's hosted verification flow and the partner's normal ticket
and payment infrastructure.

## Recommended first pilot

Start with a bounded artist presale, with registration opening before the sale.
Use one verified registration per person per event, a lottery and a small ticket
allowance. Two tickets per successful buyer is an illustrative starting point,
not an agreed policy. World ID should request the uniqueness credential suitable
for the event's assurance requirement.

Make Groucho's welcome available to all registrants, but do not use suitability
scores to rank the general lottery. Completing a long conversation should not be
a condition of ordinary ticket access. A separate, clearly labelled community
allocation could test reviewed selection later.

First prove duplicate resistance, checkout enforcement and legitimate-buyer
completion. Test resale controls only with a partner that can enforce them through
entry. An allocation-only prototype must not claim to prevent resale.

## Buyer journey

1. **Discover the presale.** The landing page explains quantity limits, registration
   deadline, allocation method, verification requirements and resale rules before
   asking anyone to enrol.
2. **Register.** The buyer creates or signs into the host account and selects the
   event. Contact information is collected by the host, separately from World ID.
3. **Verify.** IDKit launches a World ID app flow, using a QR code or connect link
   as appropriate. For Orb-backed Proof of Human, an unverified person may need to
   enrol at an Orb; a website cannot grant that credential itself.
4. **Receive confirmation.** The backend validates the proof and creates one
   registration. Returning buyers see their existing registration rather than
   consuming another entry.
5. **Meet Groucho.** An optional short artist-led conversation invites discovery,
   interest and participation. It can offer recommendations and gather consented
   feedback without pretending to assess whether someone deserves a ticket.
6. **Allocation.** Registration closes, eligible entries enter the lottery and
   winners receive a time-limited purchase opportunity. Unclaimed opportunities
   return to a waitlist through an auditable process.
7. **Purchase.** The authenticated buyer redeems the entitlement for the allowed
   quantity. The backend and ticketing partner enforce that limit.
8. **Attend or return tickets.** The buyer uses the ticketing partner's entry
   experience, approved transfer process or official face-value resale route.

Define companion tickets, gifts, minors, carers, accessible seating, account
recovery and refunds before launch. Avoid requiring a World ID app scan at the
venue in the first pilot: connectivity, lost phones and support queues could
undermine entry. Entry can use the partner's ownership-bound ticket credential,
subject to a tested exception process.

## World ID integration

The current official guide describes IDKit 4.x and the hosted v4 verification API.
Recheck SDK names, supported credentials, compatibility and production access when
implementation begins; these details are a dated research snapshot.

1. Register an application in the World Developer Portal and obtain `app_id`,
   `rp_id` and an RP signing key.
2. Generate a signed proof request on the backend. Keep the signing key secret.
   The server chooses the event action and expected account/session binding;
   neither is trusted from arbitrary browser input.
3. Use `@worldcoin/idkit` for a React widget, or `@worldcoin/idkit-core` for a
   custom JavaScript flow, to request the configured credential.
4. Have the user complete the World ID app flow and return the IDKit result to
   our backend.
5. Forward the result to
   `POST https://developer.world.org/api/v4/verify/{rp_id}`, using our configured
   relying-party ID rather than one supplied by the browser.
6. Validate success and the expected production environment, action, credential,
   binding and request context, following the current protocol documentation.
7. For a uniqueness request, use the verified nullifier to create the event
   registration under a database uniqueness constraint.

**Verification does not consume the registration.** The v4 Developer Portal
confirms cryptographic validity; our backend must prevent repeat use of the
nullifier. An older v2 API reference describes action verification limits, but
that is not the enforcement model to assume for this pilot.

For uniqueness proofs, the same person, app and action produce the same nullifier.
Choose a stable server-controlled event action across presale phases if limits
must apply across those phases. Creating a fresh action for each retry or sale
window would defeat a shared limit. Separate promoter applications cannot be
assumed to share a deduplication identity. Tour-wide limits need an explicitly
designed scope rather than an accidental event-level rule.

Use **Proof of Human** as the initial high-assurance uniqueness option. World
currently describes it as Orb-backed and suitable for one-person-one-action flows.
**Proof of Presence** uses selfie-based liveness/facial similarity and must not be
assumed equivalent. Session proofs are for returning-user flows; they must not
replace the uniqueness registration check without confirming their guarantees.

This is a user-mediated flow, not an API lookup by email or name. The integration
receives a proof rather than iris images or a verified legal identity.

## Proposed architecture and data

```text
Buyer website → pilot host backend → World ID verification API
      │                 │
      └→ Groucho         ├→ registration and allocation ledger
                        └→ ticketing partner → purchase, resale and entry
```

Keep the identity/entitlement service deterministic and independent of the LLM.
Use authenticated host sessions and bind verification to the intended local
account. A verified nullifier is a scoped deduplication value, not a password.

Suggested records, subject to implementation design:

| Record | Essential information |
| --- | --- |
| Event policy | Event/action scope, credential requirement, quantity cap, dates, allocation method and immutable policy version |
| Verification request | Account/session binding, nonce, expiry and consumption state |
| Registration | Event, local buyer ID, verified nullifier, credential/environment, eligibility state and timestamp |
| Groucho association | Registration ID and Groucho session ID; kept separate from verification evidence |
| Allocation | Registration, draw/batch ID, result, quantity and policy version |
| Purchase entitlement | Opaque token digest, buyer/event binding, expiry, quantity, reservation/redemption state and idempotency key |
| Ticket/order link | Partner reference, owner, quantity, order/payment state and transfer/resale history |
| Audit event | Actor, action, reason, policy version and correlation IDs |

Canonicalise nullifiers without loss of precision. The official guide recommends
decimal `NUMERIC(78, 0)` for PostgreSQL; never convert a 256-bit value to a
JavaScript `Number`. Enforce uniqueness within the configured relying-party,
event/action and credential context. Decide whether multiple credential types can
enter the same pool only after confirming cross-credential duplicate guarantees.

A unique registration is not a unique ticket purchase. Maintain separate atomic
reservation and redemption rules. Use single-use, short-lived entitlements,
account binding and idempotency for payment retries and partner callbacks. Resolve
payment failures and abandoned reservations without issuing duplicate tickets or
giving buyers a fresh allowance. Verify partner webhook signatures and reconcile
orders after outages.

## How Groucho fits the existing platform

The existing SDK supports conversational sessions, structured profiles and recorded
application decisions. It does not supply the proposed World ID registration,
allocation, checkout or resale ledger.

For the general lottery, registration eligibility and allocation are separate from
Groucho's suitability assessment. Store the relationship to a Groucho session for
experience continuity, not as evidence of cryptographic verification.

If a later curated allocation uses Groucho approval, follow the existing
[client-owned decision policy](../docs/client-decision-policy.md): `reviewStatus`
is authoritative, while `passed`, recommendations and scores alone do not grant
access. Human or enabled deterministic policy approval would be an additional
eligibility condition; it would still not replace verified identity or ticket
limits. Existing access secrets are not automatically suitable as ticket purchase
entitlements. Use purpose-specific credentials and server validation.

Do not ask the model to infer whether someone is a bot from polished writing,
artist knowledge or conversational style. Do not disadvantage new fans, people
using translation or assistive tools, or people who answer briefly. Reviewable
community criteria and an appeal route are prerequisites for curated selection.

## Resale and transfer policy

Identity verification addresses acquisition scale. Resale controls address profit
after acquisition and require ticketing-partner cooperation.

- Offer an official face-value resale queue, with transparent permitted fees.
- Atomically retire the seller's ticket and issue a replacement to the buyer.
- Tie entry validity to current ownership; rotating codes alone do not prevent
  account sharing or profiteering.
- Apply recipient eligibility and quantity limits to resale/transfer where policy
  requires them, so transfers cannot quietly concentrate inventory.
- Provide explicit companion, gift and carer rules. Decide whether the lead buyer
  must attend and how genuine changes of plan are handled.
- Define whether returning a ticket restores any allowance. Repeated buying and
  returning must not create more lottery entries or opportunities.
- Make refunds, cancelled events, disputes and resale settlement operationally
  complete before real money is involved.

Outside payments, credential sharing and recruited buyers remain possible. The
goal is to increase the cost and reduce the reward of organised abuse, not promise
that every secondary transaction can be observed or prevented.

## Threat model and limits

| Threat | Proposed mitigation | Remaining limitation |
| --- | --- | --- |
| Thousands of accounts controlled by one person | Verified uniqueness plus event-scoped duplicate constraint | Human recruitment and compromised credentials |
| Automated speed advantage | Registration window and lottery | Verified people can still automate later actions |
| Simultaneous checkout requests | Atomic entitlement reservation and quantity ledger | Depends on partner enforcement and reconciliation |
| Replayed or stolen proof | Server-issued context, account binding, expiry and consumed-request handling | Host account/device compromise |
| AI-written fan answers | Keep conversation outside the general access security boundary | Curated intent remains uncertain |
| Token resale or forwarding | Entitlement bound to authenticated buyer | Account sharing or remote cooperation |
| Off-platform ticket resale | Ownership-bound entry and official transfer/resale | Off-platform payments and organised collusion |
| Direct partner purchase bypass | Apply identical policy to the pilot inventory in every channel | Other event allocations may follow different rules |
| Registration flooding or denial of service | Rate limits, request budgets and protected backend endpoints | World ID does not replace infrastructure abuse controls |
| Phone loss or verification outage | Advance registration, tested recovery and support | Exceptions can weaken assurance if poorly designed |

## Privacy, inclusion and operations

World ID proofs avoid giving Groucho the underlying biometric data. The pilot still
creates personal records: host accounts, contact details, transcripts, orders and
scoped identifiers. Do not describe the entire ticket experience as anonymous.

Minimise retained proof payloads and logging. Keep signing keys and partner secrets
server-side. Set retention and deletion periods before launch, restrict access by
role, and separate optional community/marketing consent from ticket eligibility.
Avoid placing raw proofs, contact information or nullifiers in analytics events or
URLs. Groucho does not need to receive cryptographic proof material in prompts.

Measure who cannot participate because of Orb coverage, device requirements,
enrolment concerns or disability. A fallback needs a documented assurance and
allocation policy; email verification alone is not equivalent to unique-human
verification. A separately capped, reviewed exception pool may be more honest than
silently weakening the main pool. Decide this with the promoter before recruiting
buyers, and include it in measurement.

Assign owners for verification support, partner integration, lottery operations,
refunds, entry and appeals. Agree regional privacy/consumer requirements and vendor
terms with the relevant owners before launch; this document makes no legal
compliance determination. Publish plain-language rules and provide an outage plan
that preserves registrations rather than silently switching enforcement off.

## Experiment and success measures

Compare with a relevant previous presale or a clearly disclosed comparable cohort.
Differences in artist demand, inventory and audience make simple before/after
claims unreliable. Instrument registration, verification, allocation, checkout and
resale separately so friction and protection are not confused.

Track:

- Verification start/completion, latency and abandonment, segmented by device and
  enrolment status where lawful and useful.
- Unique verified registrations and repeated attempts rejected. Duplicate attempts
  are not automatically malicious buyers or proof of bots stopped.
- Distinct buyers served per ticket, enforced quantity violations and inventory
  concentration visible to the pilot.
- Lottery participation, winner conversion, waitlist reallocation and fairness
  complaints.
- Support and exception rates, including fans unable to enrol.
- Official resale volume, observed external listings and reported entry failures;
  external listing observations will be incomplete.
- Groucho completion, time spent and buyer/artist feedback on its optional value.
- Operational cost per registration/ticket, API availability and reconciliation
  incidents.

Before launch, agree numeric completion, support, cost and inclusion thresholds
with the partner. Proposed hard safety gates are: no duplicate entitlement
redemption in adversarial tests; no known purchase bypass for pilot inventory;
reconciled ticket counts; and a usable refund, recovery and entry support process.
Do not infer eliminated scalping from a low duplicate-registration count.

## Delivery stages

1. **Feasibility:** select artist/promoter and inventory; validate World ID access,
   credential availability, partner capabilities, costs and support obligations.
2. **Sandbox prototype:** implement signed verification, registration uniqueness,
   account binding and optional Groucho welcome using simulated inventory.
3. **Adversarial and usability testing:** exercise replay, changed action/signal,
   staging proof rejection, credential downgrade, concurrent redemption, retries,
   partner outages, lost accounts and accessibility journeys.
4. **Controlled presale:** freeze the policy, run a bounded sale, monitor support
   and reconcile all allocations, payments and tickets.
5. **Resale/entry trial:** proceed only once ownership and reissuance controls are
   proven end to end; test companion and exception journeys at the venue.
6. **Review:** evaluate protection, buyer exclusion, artist value and costs. Decide
   whether to expand, revise verification or stop.

## Open decisions

- Which artist, event, region, audience size and ticketing partner?
- Event-wide or tour-wide uniqueness? Does the same limit span presales and resale?
- Can intended buyers obtain the chosen credential, and what fallback is acceptable?
- Ticket allowance, companion ownership and gift/transfer rules?
- Lottery method, registration window, waitlist deadlines and audit procedure?
- Is Groucho purely optional, or is there a separate curated community allocation?
- What can the partner enforce across checkout, ownership, resale and entry?
- Who handles refunds, appeals, recovery and incidents, and what are the agreed SLAs?
- Vendor pricing, production approvals, data roles and retention requirements?
- What measured outcome would justify a second pilot?

## Sources and related repository documentation

Official World sources checked during the concept discussion on 14 October 2026:

- [World ID overview](https://docs.world.org/world-id/overview): credential types
  and assurance purposes.
- [IDKit integration guide](https://docs.world.org/world-id/idkit/integrate):
  developer registration, server signatures, v4 verification and backend nullifier
  enforcement.
- [World ID](https://world.org/world-id): user verification, Orb enrolment and
  privacy claims.
- [Developer Portal](https://developer.world.org): application registration.
- [Documentation index](https://docs.world.org/llms.txt): current SDK, credential,
  session, signature and migration documentation to consult before coding.

Repository foundations:

- [SDK documentation](../packages/sdk/README.md).
- [Client-owned decision policy](../docs/client-decision-policy.md).
- [Client integration guide](../docs/client-integration-guide.md).

Product flows, policy choices, data records and milestones above are proposals.
World's documentation supports the verification capabilities, not an independently
validated claim that this pilot will eliminate ticket abuse.
