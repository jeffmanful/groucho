# Verified fan registration and assisted review

**Status:** proposed pilot; no integration implemented or partner agreed.
**Recorded:** 16 October 2026.
**Purpose:** explore a lighter alternative to universal unique-human verification
for artist presales, combining account-control checks, proportionate friction,
Groucho conversations and protected ticket allocation.

## Motivation and claim boundary

The motivating example is a user-supplied excerpt reporting that RAYE's team
received 1.8 million registrations for a roughly 5,000-seat Royal Albert Hall show
and manually shortlisted fans after suspected bot/scalper registrations. Those
figures and attribution have not been independently verified for this document.
They illustrate the review and capacity problem; they are not evidence that any
particular check proposed here would have stopped that incident.

There is no simple web question that only humans can reliably answer. Modern
automation can generate personal stories, answer trivia and operate interfaces;
attackers can also outsource tasks to real people. The target is to increase the
cost of acquiring many usable registrations while keeping legitimate-fan effort
low. Success is fewer abusive allocations at acceptable cost and exclusion rates,
not a claim that every accepted applicant is human or a genuine fan.

Distinguish five separate questions:

1. Does someone control this account or communication channel?
2. Was a person present for a particular interaction?
3. Is this a distinct person rather than another account for the same person?
4. Is there evidence of a relationship with the artist?
5. Will this person respect purchase and resale rules?

Email, social accounts, passkeys, liveness and fan history answer different parts
of this list. No single one answers all five. A verified person can be a scalper.

## Product proposition

Groucho welcomes applicants, gathers brief fan context and makes review manageable.
A deterministic registration service validates evidence and enforces limits. A
ticketing partner enforces purchase entitlements, quantities, transfer and resale.

For the main pool, use a lottery among eligible registrations. Do not rank access
by literary ability or Groucho's suitability score. If the artist wants a curated
fan allocation, define it as a separate, disclosed pool with human review and
published criteria. A raffle or lottery does not solve duplicate identities by
itself: each extra accepted account increases an attacker's chances.

## Recommended initial journey

1. Publish the window, allocation method, quantity cap, permitted verification
   routes, support path and transfer rules.
2. Apply rate limits and a managed anti-abuse check before email delivery or AI
   inference. Verify the email and create an authenticated local registration.
3. Offer Instagram DM account-control verification, with a non-social alternative
   such as phone verification or a reviewed existing fan account. These routes
   have different assurance and must be measured separately.
4. Enforce event-level uniqueness for each verified identifier. Link additional
   evidence to the same registration; completing more routes earns no extra entry.
5. Invite a short Groucho conversation, normally optional for the general pool.
6. Route concrete anomalies to a step-up check or review. Do not automatically
   reject applicants merely for missing optional social history.
7. Close registration, resolve outstanding checks and freeze eligibility before
   the draw. Give winners account-bound, single-use purchase entitlements.
8. Reconcile partner orders and reallocate expired opportunities through a
   documented waitlist process. Apply resale controls where the partner supports
   them; otherwise describe the pilot as registration/allocation protection only.

Multiple accounts per person remain possible. Phone and Instagram paths are not
equivalent to the unique-person guarantee sought in the
[World ID pilot](./fair-ticket-access-world-id.md). Someone could enter once
through each route; verified contact details and local account linking reduce
some overlap but cannot establish universal cross-route uniqueness. Measure this
residual risk, and do not label the result “one person, one entry.”

## Instagram: feasible ownership check, not a real-person verdict

Meta's standard Instagram Login integration is for professional accounts, so
ordinary fans should not be told to convert their personal accounts to use it.
The proposed alternative uses the artist's professional inbox and a fan-initiated
message. Meta documents professional-account messaging; this exact binding flow
still needs a production-permissions and usability proof of concept. [S1, S2]

Proposed protocol:

- The authenticated website generates an unpredictable, short-lived, single-use
  challenge bound to the event and local account.
- The fan sends the challenge to the artist's official Instagram inbox.
- A signature-validated messaging webhook supplies the message and platform sender
  identifier. Do not accept a typed handle, screenshot or browser assertion as
  equivalent evidence.
- The backend binds that sender identifier in the artist's integration context to
  the registration. Deduplicate atomically within that event and scope; handles
  can change, and identifiers must not be assumed portable across integrations.
- The website confirms ownership after backend validation. Challenge attempts,
  retries and expiry are bounded; codes are not reusable presale credentials.

Test private accounts, message requests, teenage-account restrictions, account
switching, delayed/duplicate webhooks, identity scope, rate limits, production app
review and support load. If attackers forward codes to account owners, this proves
cooperation/control at that moment, not exclusive ownership by the website user.

Do not promise account creation dates, historic follow dates, private post access,
a complete follower list or a platform “real human” score. Establish available
fields and allowed uses through official documentation and live testing first.
Current follower status, if available in an approved context, would not prove
longstanding fandom. Do not scrape profiles or require public posting as a fallback.

## Check catalogue

These are engineering assessments and pilot hypotheses, not measured vendor
comparisons or guaranteed detection rates.

| Technique | What it supports | Automation and abuse limits | Pilot recommendation |
| --- | --- | --- | --- |
| Verified email | Mailbox control and contactability | Cheap accounts and automated mailbox access | Baseline only |
| Managed bot challenge, e.g. Turnstile | Probabilistic anti-abuse assessment | Does not prove a unique human; relay and human assistance remain threats | Baseline, validated on the server [S3] |
| Instagram challenge by DM | Control of a platform account | Bought, farmed or multiple accounts; delegated responses | Candidate social route after feasibility tests |
| SMS code | Access to a phone number | Rented numbers, multiple SIMs, recycling and forwarding | Candidate alternative/step-up with spend limits [S4] |
| Passkey with user verification required | Control of an enrolled authenticator, with local PIN/biometric verification | Not unique personhood; many accounts/authenticators and software authenticators exist | Useful account protection; test as step-up, not universal identity [S5] |
| Existing first-party artist relationship | Prior purchases or fan-club participation before the sale announcement | Account takeover, resale, exclusion of new fans; paid history reflects resources | Optional corroboration or separately disclosed pool |
| Second confirmation in an advance window | Continued control and commitment | Trivially schedulable by bots; disadvantages busy fans | Operational tool only; generous deadline |
| Random personal fan question and follow-up | Context for review and community experience | LLMs can answer; no truth or humanity guarantee | Groucho experience, not a security gate |
| Audio/image choice with explanation | Music discovery and preferences | Multimodal AI can interpret content; sensory and language barriers | Optional research only, no correct-answer identity test |
| Mouse/typing/timing signals | Weak anomaly evidence in aggregate | Can be imitated; assistive tech, paste and translation can look unusual | Never sole rejection evidence |
| Honeypot fields and invalid-flow detection | Naive form automation or protocol violations | Sophisticated bots avoid them; autofill can trigger fields | Supporting evidence with false-positive testing |
| Live selfie/presentation-attack detection | Probabilistic evidence of a person before a camera | Injection, spoofing and human farms; does not inherently deduplicate people | Consider only after lower-friction pilot evidence [S6] |
| Short live human review | Real-time interaction and resolving ambiguous cases | Skilled impostors and paid humans still pass; costly to staff | Small exception pool with accessible alternative |
| Strong unique-human credential | Stronger resistance to many identities per person within its scope | Enrolment coverage, recovery and collusion remain constraints | See separate World ID pilot |
| Card authentication or refundable deposit | Payment control/economic commitment | Cards and funds can be scaled; introduces affordability/refund problems | Not initial registration baseline |

The closest checks to requiring human participation are properly implemented
authenticator user verification, specialist liveness and live human review. Their
precise claims differ: a passkey authenticates a credential, liveness estimates
physical presence and an interview observes interaction. None guarantees unique
personhood, genuine fandom or absence of later automation. A manual “record a
video saying this code” upload is not equivalent to a tested liveness system.

Do not design bespoke distorted-image, audio, emotion, sarcasm or memory puzzles
and assume machines cannot solve them. W3C documents both security weaknesses and
accessibility barriers in interactive CAPTCHA approaches. [S7]

## Progressive friction policy

Start with minimal checks. Escalate on concrete, documented signals, such as an
already-used verified identifier, repeated invalid challenges or unusually many
linked submissions. Shared IPs, VPN use, private profiles, low follower counts,
fast typing and missing photos are not proof of abuse.

Example policy to validate:

| Condition | Action |
| --- | --- |
| Valid baseline and one accepted account-control route; no unresolved anomaly | Eligible for general lottery |
| Same verified identifier returns | Resume existing registration; do not issue another entry |
| Evidence is incomplete or provider is unavailable | Save progress and offer retry/alternative; pending rather than silently accepted |
| Several concrete correlated anomalies | Request one additional independent control check or human review |
| Proven replay, forged callback or quantity-limit violation | Reject the operation, record reason, retain an appeal route for the applicant |

Do not turn these into an opaque “human score” generated by Groucho. Preserve
check-specific results, source, timestamp, reason and policy version. Additional
checks must not create more lottery chances. Fallback routes need explicit rules
so an attacker cannot deliberately fail into an easier unchecked path.

## Groucho's role and decision boundaries

Use one or two short questions, with a follow-up only when useful. Example:
“Which song do you keep returning to, and what brings you back?” Do not require
obscure facts or judge whether an emotional story is true. A fan can decline to
share personal experiences. Optional structured choices can reduce writing effort.

Reviewer cards should separate verified account facts, unverified applicant claims,
available first-party history and unresolved contradictions, with source links.
Groucho can summarise and group cases for review; duplicated phrasing alone is not
proof of fraud. Translation, common prompts and shared experiences produce overlap.
Measure reviewer agreement and sampled omissions before relying on prioritisation.

Keep registration eligibility separate from Groucho application decisions. For a
curated pool, follow the existing [decision policy](../docs/client-decision-policy.md):
model outcomes and scores do not independently grant access. A recorded approval
is still distinct from ticket inventory allocation and entitlement redemption.

## Backend and capacity requirements

Proposed components are new work: evidence adapters, registration ledger,
challenge/webhook handling, rules, review queue, allocation and ticket integration.

Store event policy, local account, scoped verified identifiers, evidence statuses,
challenge consumption, Groucho session link, review audit and allocation/order
references. Protect credentials server-side; authenticate callbacks and use database
constraints and transactions for duplicate prevention and entitlement redemption.
Use idempotency across retries, partner webhooks and reconciliation.

For Turnstile specifically, call Siteverify on the backend, validate the intended
hostname/action and applicable context, and consume the result for the protected
operation. Its tokens expire after five minutes and are single-use; refresh without
discarding fan input. Do not treat a successful browser widget as authorisation. [S3]

Run inexpensive checks before paid email/SMS and LLM calls. Bound attempts, message
delivery and inference costs per event/account and globally. Twilio documents SMS
pumping abuse: verification endpoints themselves can generate fraudulent costs.
Provider fraud controls complement, rather than replace, our budget caps. [S4]

At the example's unverified scale, three turns per 1.8 million applicants would
mean 5.4 million model turns before retries. This arithmetic is not a traffic or
pricing forecast. Queue work, cap turns, avoid synchronous profile extraction in
registration and specify what happens when capacity is exhausted. A pilot should
prove the flow with bounded traffic before accepting a stadium-scale campaign.

## Allocation and resale

Publish the lottery rules and record eligibility snapshots, draw results and
waitlist actions. No first-come advantage within the registration window. Waiting
alone is not bot deterrence; the purpose is to remove the speed race.

Presale codes must be account-bound and single-use, with expiry and enforced
quantity limits at the ticketing backend. Shared links or unbound reusable codes
undermine registration checks. Reconcile payment failures and reservations so
retries cannot increase the allowance.

Face-value resale, controlled transfer and ownership-bound entry require partner
cooperation. The controls and companion/recovery exceptions in the
[World ID pilot](./fair-ticket-access-world-id.md#resale-and-transfer-policy) apply
here too. Account control cannot stop a successful buyer arranging an outside
payment. Do not market this pilot as complete scalping prevention.

## Inclusion and privacy

Provide a route for people without Instagram, smartphones, public profiles or prior
artist purchases. Offer accessible retry and review paths. Do not require disclosure
of disability, trauma or private social content to establish fandom. No penalty for
translation, assisted writing, pasting or using a screen reader.

Retain the minimum account-control evidence needed for the event and disputes;
set a deletion schedule before launch. Restrict reviewer access and avoid collecting
entire social histories. Explain separately what the social integration, ticketing
host and Groucho store. Marketing consent is separate from ticket eligibility.

Biometric/liveness options introduce additional data and accessibility obligations;
establish necessity, vendor retention/training settings, regional requirements and
an alternative before trialling them. This proposal does not establish legal
compliance or approve any vendor contract.

## Validation and experiment plan

1. Prove Instagram DM binding in an approved integration using consenting test
   accounts, including personal/private accounts and real webhook delivery.
2. Build simulated-inventory registration and test duplicate races, replay,
   account takeover/recovery, alternate-route duplication, provider outages and
   ticketing bypasses. Use official test keys/environments for bot-check testing.
3. Compare minimal checks against the proposed layered flow on comparable,
   disclosed cohorts; no cohort should lack essential purchase protections.
4. Run accessible fan usability sessions and a bounded adversarial exercise with
   synthetic accounts and realistic automated answers. Do not attack third-party
   platforms or infer production detection from test-environment challenge passes.
5. Launch a limited presale after agreeing thresholds and operational owners.
6. Review results before adding universal friction or stronger identity checks.

Track completion time, verified-route success, abandonment, support/appeal outcomes,
provider/inference cost, reviewer time and observed abusive allocations. Measure
alternate-route behaviour and exclusion separately. Sample accepted and flagged
registrations for blinded review with an “unknown” label; uncertain intent must
not be forced into a human/bot verdict. Report controlled attack detection and
legitimate-fan rejection separately. Challenge failures or duplicate attempts are
not equivalent to bots stopped.

Agree numeric fan-completion, support, cost and observed-abuse thresholds before
launch. Hard gates include no known entitlement bypass, no duplicate redemption
in concurrency tests, working provider-outage handling and reconciled inventory.

## Open decisions

- Artist, region, ticketing partner, inventory size and registration window?
- Instagram permissions and throughput sufficient for the intended audience?
- Acceptable non-social route and residual cross-route duplication?
- Whether the general conversation is optional, and whether any curated pool exists?
- Which independent step-up check provides measurable benefit over baseline?
- What history is actually available, consented and fair to use?
- Who handles reviews, provider incidents, appeals, entry and refunds?
- What evidence would justify World ID or liveness instead of adding more weak checks?

## Sources

Official sources consulted on 16 October 2026. Vendor capabilities are source-backed;
the recommended combinations and expected friction effects are proposals requiring
testing. Recheck current permissions, terms and API versions before implementation.

- **S1:** [Meta Instagram Login API](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login) — professional-account integration scope.
- **S2:** [Meta Instagram messaging documentation](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-1ff01566-3509-48bd-a0f4-8571a91ccfdf) — user-initiated messaging requirements; not an approval of this proposed verification service.
- **S3:** [Cloudflare Turnstile server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) — backend validation, token expiry and single-use requirements.
- **S4:** [Twilio Verify Fraud Guard](https://www.twilio.com/docs/verify/preventing-toll-fraud/sms-fraud-guard) and [SMS pumping explanation](https://www.twilio.com/docs/glossary/what-is-sms-pumping-fraud) — verification-delivery abuse and mitigation.
- **S5:** [FIDO Alliance passkeys](https://fidoalliance.org/passkeys-2/) — account authentication and requested user verification using local PIN/biometric.
- **S6:** [AWS Face Liveness documentation](https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness.html) — probabilistic presence assessment; vendor example, not a selected provider.
- **S7:** [W3C Inaccessibility of CAPTCHA](https://www.w3.org/TR/turingtest/) — Group Draft Note discussing security and accessibility limitations, not a universal certification standard.
