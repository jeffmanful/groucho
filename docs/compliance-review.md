# Groucho compliance and legal workstream

Initial source review: 13 November 2026. Status: working assessment, not legal sign-off or a representation of compliance. Confirmed by the founder: UK-first launch, EU users possible, and no real applicants handled yet. The operating/contracting legal entity remains unconfirmed. Product, engineering and qualified counsel should resolve the open decisions together.

Technical follow-through, 13 November 2026: [session retention/deletion controls](session-privacy-operations.md) are now implemented in source with disabled-by-default project policies, previews, expiring holds, transactional deletion and replay suppression. No hosted migration or deletion was run. This partially addresses the retention/rights action below; full rights fulfilment, provider/browser lifecycle and deployed verification remain outstanding. Keep the legal entity pending while progressing that technical work.

## Scope and evidence limits

Treat this as pre-launch readiness work. Assess UK requirements first and EU territorial scope separately before opening relevant flows; possible EU users alone do not settle which EU obligations apply. No real applicants yet does not establish that staff, demo or tester data contains no personal information. Use synthetic applicant records for compliance verification.

Reviewed repository architecture, decision policy and corrections, applicant signals, cultural signals, browser storage, API routes, retention guidance and database migrations. No production records, environment secret values, deployed configuration, signed contracts or vendor account settings were inspected. A missing repository workflow does not prove no manual process exists. Source controls are not evidence of their deployment or effectiveness.

Conversation quality gate: **Will this change positively or negatively affect the conversation experience?** Expected positive effect: people understand the AI, the assessment and their choices before sharing personal information. Tradeoff: legal interruptions can make conversation feel coercive or bureaucratic. Use a concise notice before collection and persistent access to details and help; require separate consent only where the selected purpose actually needs it. These documentation changes do not change runtime conversations.

## What Groucho processes

| Processing | Evidence | Privacy consequence |
| --- | --- | --- |
| Applicant identity and intake | `sessions.applicant_email`, `applicant_name`, `applicant_details`; [schema map](database-schema.md), [identity migration](../supabase/migrations/20260527123000_session_applicant_identity.sql) | Identify required and optional fields per use case; third-party details may appear in free text. |
| Conversation and derived profile | `messages`, metadata, profile extraction; [runtime](architecture.md), [extraction](../lib/profile-extraction.ts) | Both supplied statements and model inferences can be personal data. Review accuracy and unnecessary collection. |
| Assessment and access decisions | Suitability scores, reports, decisions, corrections, cohorts and outcomes; [policy](client-decision-policy.md), [workspace](client-decision-workspace.md) | Profiling and potential exclusion need purpose-specific fairness and decision safeguards. |
| Connection signals | [applicant-signals.ts](../lib/applicant-signals.ts), [migration](../supabase/migrations/20261027200000_applicant_signals.sql) | This code persists keyed IP/network hashes, user agent and language, not raw IPs. Linked hashes remain personal data; this does not establish what hosting logs retain. Hash inputs do not include a tenant salt; assess cross-tenant linkability. |
| Community insights | [cultural signals](colors-cultural-signals.md), [migration](../supabase/migrations/20260817200403_add_project_cultural_signals.sql) | Project opt-in is an operator setting, not applicant consent. Source-linked observations remain personal data; aggregation thresholds alone do not establish anonymity. |
| Account/admin activity | Organisation members, invitations, settings audit, reviewer identities | Separate applicant processing from Groucho's own account/security responsibilities. |
| Browser state | [doorcheck](../app/doorcheck/experience.tsx), SDK `Gatekeeper` and `GatekeeperV2` | Local storage includes profile/reviewer-report paths; SDK uses session storage for session IDs. Review each surface, purpose, expiry and shared-device exposure. |
| External delivery | [integration](client-integration-guide.md), [webhook schema](event-payload-session-completed.schema.json) | Client exports and webhook recipients create further copies; deletion in Groucho does not recall them. |

## Role and lawful-basis decisions

Working role model to validate, not contractual fact:

- The client is likely controller for its application purpose, criteria and admission decision; Groucho likely processes that data under client instructions. Client-owned settings do not alone determine legal roles.
- Groucho may be controller for its own account administration and security purposes. Independent reuse for product research, training or cross-client insights needs a separate role/purpose assessment; do not assume the client DPA covers it.
- Build a record of processing by purpose: subjects, fields, recipients, legal role, lawful basis, transfers, retention, rights handling and owner. Select the basis for each purpose, rather than one blanket basis for all chats. Document a legitimate-interests assessment if relying on legitimate interests. Do not assume contract necessity or consent simply because someone starts a chat.
- A disclosure of sensitive information in conversation is not automatically explicit consent to assess or reuse it. Identify any applicable Article 9 condition separately from the Article 6 basis; also assess criminal-offence data where relevant. Prefer avoiding unnecessary sensitive inference and removing such material from assessment inputs.

Controller/processor contracts must describe the processing and address instructions, confidentiality, security, subprocessors, rights assistance, return/deletion and audits. See [ICO contract guidance](https://app-ico-public-prod-uksouth.azurewebsites.net/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/contracts-and-liabilities-between-controllers-and-processors-multi/what-needs-to-be-included-in-the-contract/) and [ICO special-category guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-are-the-rules-on-special-category-data/).

## Decision-making, DPIA and fairness

Existing foundations: automatic acceptance and decline default off; model recommendations are advisory; policy decisions record a policy snapshot; human corrections append history. Public simulations skip the real application assessment/decision pipeline. See [decision policy](client-decision-policy.md).

These are useful controls, but a deterministic threshold applied to a model score can still be solely automated decision-making. An admin dashboard or later correction endpoint does not establish meaningful human involvement before a decision, or an accessible applicant appeal.

For each deployment, assess whether the decision has legal or similarly significant effects. Membership, scarce access, work and education contexts cannot be treated as interchangeable. Human reviewers must be able to understand the evidence, consider corrections and depart from the recommendation. Assess score ordering and automation bias too.

The UK position has changed: DUAA amended the automated-decision regime. Do not apply the old UK Article 22 prohibition as if unchanged. Significant solely automated decisions require relevant safeguards, including information, representations, human intervention and contestability; special-category processing has additional restrictions. EU GDPR Article 22 requires a separate analysis. See [current UK change summary](https://ico.org.uk/about-the-ico/what-we-do/legislation-we-cover/data-use-and-access-act-2025/the-data-use-and-access-act-2025-duaa-summary-of-the-changes/data-protection/) and [EU GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj).

Complete DPIA screening now for real applicant assessment. ICO lists decisions affecting access to services/opportunities involving automated decision-making or special-category data among processing requiring a DPIA in the relevant circumstances. Where required, finish the DPIA before processing, document residual risks and consult the regulator if high risks cannot be sufficiently reduced. See [ICO screening criteria](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/when-do-we-need-to-do-a-dpia/).

Fairness review should cover language fluency, disability, cultural familiarity, financial means and other potential proxies for protected traits. Review complete synthetic conversations and assessment reports, including sparse answers, refusals and corrections; do not infer fairness from a prompt instruction. Do not collect protected traits for testing without a lawful, proportionate plan.

## Prioritised delivery plan

All items below are proposed work. Owners are functions to assign, not existing appointments. P0 means evidence to resolve before a new real-applicant launch; for an already-live service, triage immediately with its operator.

| Priority | Work and proposed owner | Evidence needed to close |
| --- | --- | --- |
| P0 | Confirm entity, territories, actual live uses and legal roles — founder + counsel | Named contracting entity/controller, launch-scope matrix and signed role/purpose assessment. |
| P0 | DPIA, lawful bases and sensitive-data policy — privacy lead + client | Completed screening/DPIA as applicable, basis per purpose, risk treatments and accountable approval. |
| P0 | Applicant notice and AI disclosure — product + privacy | Notice before collection on each host surface, linked full notice and working contact route. Record notice version where useful for accountability; acknowledgement must not be mislabelled consent. |
| P0 | Human review and contestability — client operations + engineering | Named reviewer, applicant route, response process, understandable reasons, authority to change outcomes and an end-to-end corrected-decision test in the host product. Assess whether automation should remain disabled per use case. |
| P0 | Retention and individual rights — privacy + engineering | Approved purpose-based periods, verified access/rectification/restriction/objection/erasure process, narrow holds, deletion evidence, job-race protection and backup/recipient handling. No complete individual-rights workflow was identified in the reviewed routes. |
| P0 | Vendor and client contracts/transfers — legal + operations | Executed DPA and service terms, authorised subprocessor register, regions/remote access, retention/training terms and valid transfer mechanisms where required. |
| P0 | Production access and incident verification — engineering + operations | Tenant/role/ownership tests, sensitive-response filtering, log review, actual provider configuration and incident drill. Existing source checklists are not completed evidence. |
| P1 | Browser storage review — engineering + privacy | Inventory per SDK/demo/host, purpose and expiry, applicable PECR exemption or consent, shared-device clearing. Remove unnecessary personal/report data after reviewing the actual flow. |
| P1 | Cultural insights/research boundaries — product + privacy | Separate purpose/basis and notice, validated suppression/reidentification assessment, deletion/snapshot test, controlled evaluation datasets. |
| P1 | Ongoing accountability — leadership + privacy | Assigned privacy owner, staff access/training, complaints process, processing register, review cadence; assess ICO fee, DPO and representative obligations against actual scope. |

## Notices and legal documents to prepare

1. Applicant privacy notice, plus a short pre-chat explanation naming the controller, AI use, assessment purpose, who receives the conversation and where to seek help/review. Full notice must cover the applicable information requirements, including retention, transfers and rights. Keep marketing permissions separate. See [ICO right to be informed](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-be-informed/).
2. Groucho account/business privacy notice for its own controller activities.
3. Client services agreement/order form and DPA with processing and security schedules, subprocessor arrangements, decision responsibilities, rights assistance, incident escalation and end-of-contract deletion.
4. Subprocessor/transfer register, retention schedule, rights/complaints runbook and incident-response plan.
5. Context-specific acceptable-use and consumer-facing terms where needed. Review equality/accessibility, consumer fairness, persona/brand/content permissions and age/minor handling with counsel; applicability depends on each actual use case.

Do not publish assurances such as “anonymous”, “never used for training”, “UK-only storage” or “GDPR compliant” without evidence for every relevant system and vendor. Do not promise that every decision has a human reviewer if automation can be enabled.

If EU AI Act scope applies, assess provider/deployer roles, use-case classification and Article 50 disclosure obligations. Chatbot transparency requirements apply from 2 August 2026; other obligations have separate timelines. Do not label every membership assessment high-risk without classification. See [Commission transparency guidance](https://digital-strategy.ec.europa.eu/en/policies/guidelines-ai-transparency-obligations).

## Vendor and transfer evidence register to complete

| Service/path seen in source | Status of evidence | Information to obtain |
| --- | --- | --- |
| Supabase database/auth | SDK and migrations present; deployment unverified | Contracting entity, project region, backups, deletion, support access and DPA. |
| Anthropic conversation/extraction | SDK calls present | API account/contract, actual routing, prompt/output retention, abuse monitoring, training terms and transfers. |
| Vercel/hosting | Hosting references and headers present; deployment unverified | Actual host/regions, request logs, retention, remote access and DPA. |
| Resend organisation invitations | Optional API path present | Whether enabled, recipient fields, retention, region and DPA. |
| Typesafe/OpenRouter evaluation scripts | Experimental code paths; not established as production recipients | Whether executed with personal data, datasets sent, routing and downstream terms. |
| Client host, webhook recipients and CSV exports | Integration-specific | Recipient identity, payload minimisation, permissions, further transfers and deletion cooperation. |

An EU/UK database region does not settle overseas support access or onward transfers. Document the relevant adequacy/safeguard route and assessment where required; see [ICO transfer guide](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/a-brief-guide-to-international-transfers/).

## Rights, retention and incident acceptance criteria

- Locate a verified applicant's records across the correct client/tenant and all relevant identifiers. Export applicable personal data including inferences/reports and decision history, not just chat text, while protecting other people's data and secrets. Rectification should address inaccurate source facts and derived records appropriately; preserve legitimate historical context only where justified.
- Track request receipt, scope, identity verification, responsible controller and deadline. Subject access normally requires response without undue delay and within one month, subject to applicable timing/extension rules; see [ICO access timing](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/right-of-access/what-should-we-consider-when-responding-to-a-request/).
- Erasure must cover applicable transcripts, profiles, reports, signals, jobs, verdicts, decisions, invitation/cohort/outcome records and derived snapshots. Prevent queued/retried work from recreating erased data. Verify actual foreign keys, grants and triggers with synthetic records. The cultural-signal migration includes source cascades and historical snapshot invalidation; confirm this in the intended database rather than describing it as missing.
- Append-only audit design is not a blanket retention exemption. Check lawful exceptions/holds, their scope and expiry; verify decision correction references do not frustrate authorised deletion. Organisation deletion is not a substitute for individual erasure.
- Establish backup expiry and restoration procedures that reapply deletions before restored data returns to use. Track provider and recipient obligations separately; avoid promising instant deletion from every backup.
- Maintain an incident owner, escalation route, evidence log and notification decision record. A processor must notify its controller without undue delay; a controller's notifiable breach has the applicable 72-hour regulator deadline, and high-risk breaches require notification to affected people without undue delay. See [ICO breach guidance](https://ico.org.uk/for-organisations/report-a-breach/personal-data-breach/personal-data-breaches-a-guide/).

## Immediate decisions outstanding

- Which legal entity operates Groucho and signs client contracts? Who owns privacy requests?
- Which client/use case launches first, and will either automatic decision switch be enabled? No real applicants are using Groucho yet, as confirmed by the founder.
- Beyond the confirmed UK-first scope, will Groucho target EU residents or monitor behaviour in the EU? Are children allowed or likely to use each experience?
- Which vendor accounts, regions and contractual data-use terms apply? Are prompts, transcripts or reports reused for evaluation, training or insights?
- What retention periods can each controller justify, and who handles review/appeal requests in practice?

Next implementation slice after these facts are settled: notice configuration and host integration, then a tenant-scoped rights/retention workflow with verified deletion and human review handoff. Keep decision-specific legal validation separate from conversational judgement and booking/date checks.
