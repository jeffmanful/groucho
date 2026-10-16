# Ticket access: product direction

**Recorded:** 16 October 2026. **Status:** discovery direction, not a shipped
ticketing product or agreed external pilot.

## Proposition

Groucho helps event teams assess registrations, inspect evidence and allocate
limited tickets through explicit rules, human review and lotteries. It gives fans
an artist-led welcome and gives operators a manageable way to handle scarcity.

The working pitch is: **help teams reduce abusive registrations and give genuine
fans a fairer opportunity to buy tickets.** Do not promise that AI conversation
stops bots or that registration checks eliminate scalping.

The product connects four stages:

1. **Register:** gather contact details and optional short fan context.
2. **Assess:** validate account control, surface concrete anomalies and present
   relevant relationship evidence with sources.
3. **Review:** let operators inspect, clear, hold or resolve registrations under
   an explicit policy.
4. **Allocate:** freeze an eligible cohort, draw fairly and issue buyer-bound
   purchase opportunities through the ticketing partner.

Groucho's value is the coherent workflow. Email checks, Instagram and World ID are
potential evidence adapters within it, rather than the entire product.

## What the founders' discussion establishes

The supplied Postern export records Dan asking for a demo instance he can operate,
Jeff proposing combined checks and cohort lotteries in a sensible dashboard, and
Jacob supporting a short prototype sprint and a clear business/fan proposition.

The screenshots show a warm request for feedback to Fi and willingness to meet.
Her supplied LinkedIn screenshot describes her as Director of Touring at AEG
Presents. Next Friday was proposed, but she needed to resolve a scheduling conflict.
Plan for **Friday 23 October 2026, Europe/London**, with time and attendance still
to be confirmed. No AEG endorsement, pilot agreement or artist commitment exists
in the supplied material. The Ezra Collective website screenshot is context, not
evidence of an artist-specific pilot.

The founders' ambition to benefit fans, artists, venues and promoters is a product
hypothesis. Discovery must establish the operational benefit, who pays and who
controls the required ticketing integrations. The mention of Departmnt's screening
layer is a discovery lead, not a verified competitor capability comparison.

## Product boundaries

- Separate account control, physical presence, unique personhood, artist
  relationship and resale intent. Evidence for one does not establish the others.
- Keep deterministic validation and allocation outside LLM judgments.
- Do not use conversational polish, follower count, private profiles or lack of
  public history as a general ticket eligibility test.
- Keep the main pool's lottery distinct from any disclosed, curated allocation.
  More optional evidence does not buy more entries.
- Keep registration risk separate from Groucho suitability and final application
  decisions. Follow the existing [decision policy](../docs/client-decision-policy.md).
- Define purchase entitlement, quantity, transfer and resale enforcement with the
  ticketing partner. A review dashboard cannot enforce those controls by itself.

## Evidence and the operator experience

The evidence card should distinguish **verified**, **observed**, **claimed** and
**unknown**. Every flag needs a source, timestamp, scoped reason and review action.
Provider outages are unavailable evidence, not failed identity checks.

### Email and coordination signals

Proposed signals include verification state, known disposable-provider indicators,
sequential local-part clusters, repeated naming templates and unusual event-level
submission concentrations. Individual strange-looking addresses are weak evidence.
Numbers, privacy relays and ordinary providers must not be treated as bot verdicts.

Show cluster facts, for example “12 similarly structured addresses submitted in
four minutes,” rather than “12 bots.” Domain concentration can reflect a workplace
or university. Avoid universal plus-tag/dot removal: mailbox alias semantics vary
by provider. Distinguish exact duplicates from cautiously inferred aliases.

Use explicit filters: verification status, unresolved risk flags, duplicate links,
review state and cohort membership. Filtering a list must not silently exclude
people from allocation. Confirmed eligibility is a separate recorded state.

### Social presence and relevant history

Start with Instagram DM proof of account control, subject to permissions and live
testing. It does not grant access to a private feed or establish one personhood.
Relevant first-party records, such as a consented prior purchase, may corroborate
an artist relationship but must not disadvantage new fans in the general pool.

Allow applicants to optionally supply relevant public links for source-backed
review. Matching names/photos alone do not establish identity. Do not introduce
automatic broad web searches, personality judgments or sensitive-trait inference.
Missing public evidence stays unknown. Respect platform access restrictions and
publish retention, access and alternative-verification policies before a pilot.

## Discovery questions that determine the pilot

- Where does abuse cause the most damage: registration, shortlisting, code sharing,
  checkout or resale? What does the team do manually today?
- Which evidence and existing screening tools are available? Where do they fail?
- Who owns eligibility policy, inventory and final allocation decisions?
- Can the ticket seller accept buyer-bound opportunities and enforce quantities?
- What verification friction and support volume can the audience tolerate?
- Is an allocation/review tool independently valuable before full ticket integration?
- What bounded event or presale would make a useful experiment, and what baseline
  would show improvement?

## Related plans

- [Fi discovery demo: 23 October](./fi-demo-2026-10-23.md).
- [Verified fan registration](./verified-fan-registration.md): lighter checks and
  progressive friction; includes dated official sources and limitations.
- [World ID pilot](./fair-ticket-access-world-id.md): stronger uniqueness route and
  ticket lifecycle controls.

This direction synthesises the supplied founder discussion and this chat's pilot
exploration. It creates no external commitments or implementation authorisation.
