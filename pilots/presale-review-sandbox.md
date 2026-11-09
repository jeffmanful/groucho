# Presale review sandbox

Recorded 8 November 2026. Proposed scope for a sandbox with Sascha.

Can an organiser take a presale export, resolve ambiguous groups of registrations
and hand off an eligible list? In the written pitch debrief, Dan relayed Sascha's
estimate of 40% bot signups and the example of several registrations sharing an IP.
Treat the estimate as meeting feedback. Use the rehearsal to learn which evidence
helps Sascha distinguish possible abuse from a household signing up together.

## Build before the export arrives

1. Seed an isolated, resettable project with synthetic form-only entries. Reuse
   [entry validation and persistence](../lib/entries.ts). Prototype an internal
   CSV importer with a dry run, row errors and stable keys from source registration
   IDs so retries after partial writes are safe. Keep separate source rows even
   when their emails match. Preserve signup time separately from import time.
2. Reuse [entry review](../lib/entry-review.ts) for exact email, phone and social
   matches and the existing disposable-domain flag. Apple Hide My Email appears as an informational label in Entries and the
   connection panel. Use **Shared connection** on an entry to review the
   project-scoped group, signup timing and overlapping email or phone flags. Live intake uses
   [hashed connection signals](../lib/applicant-signals.ts).
3. Rehearse through the real Entries workspace. Include a legitimate household,
   recognised privacy relays, an exact duplicate, a temporary inbox and a burst
   with multiple overlapping signals. Import the fixture twice, review groups,
   leave unresolved entries pending and export an approved cohort using the
   [existing allocation workflow](../docs/client-decision-workspace.md).

Ask for column headers and two fully fabricated examples. Follow the
[pilot data requirements](#pilot-data-requirements) before accepting any real
signup data. Capture review time, flags Sascha clears, cases left unresolved
and whether the handoff is usable. Keep shared connections and email
observations advisory. Eligibility is a separate operator decision.

**Conversation impact.** Historical entries stay form-only. Keeping email and
connection evidence in operator review avoids adding identity questions to the
fan conversation. The tradeoff is fewer signals where the source file lacks data.

## Pilot data requirements

### Discovery and walkthrough

Use the [synthetic sandbox](sascha-sandbox-walkthrough.md). Ask Sascha for the
export headers and two fully fabricated cases that reflect his review work.
One could show a household sharing a connection and the other a suspicious
burst with overlapping details. Ask which clues he would use and what would
remain uncertain. Use invented identifiers and timestamps throughout.

### Before accepting real data

Agree a separate, small historical batch with the organiser. Run it in shadow
mode and compare results with past reviews. Keep the results out of live
eligibility and fulfilment. Record who is authorised to share the data, the
pilot purpose, the applicable lawful basis and privacy notice, the parties'
roles and processor terms where applicable. Screen for a DPIA before moving
towards live eligibility decisions. [ICO purpose limitation guidance](https://cy.ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/purpose-limitation/) · [ICO processor contract guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/contracts-and-liabilities-between-controllers-and-processors-multi/what-needs-to-be-included-in-the-contract)

| Evidence | Proposed minimum for a historical batch |
| --- | --- |
| Registration | Stable source row ID and original signup timestamp with timezone. Limit the batch to one agreed presale. |
| Connection | Opaque group ID assigned by the organiser, if available. Keep raw IPs at source. |
| Email and phone | Stable match tokens within the batch where needed. Prefer disposable and Apple relay labels derived at source. |
| Review benchmark | Optional prior review outcome or reason code where available and needed for comparison. Keep it separate from Groucho's flags. |
| Handoff | Agree which identifiers and columns the organiser needs back. Start with source row IDs and review outcomes. |

Keep names, raw contact details, free text and payment details out of the first
real batch. Treat linkable tokens as personal data. The current CSV importer
requires a valid email and derives domain flags from it. A token-only batch
therefore needs an adapter for match tokens and source-derived labels before
upload. [ICO pseudonymisation guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/anonymisation/pseudonymisation/)

Use named reviewer accounts and agree who can import and export. Confirm the
secure transfer method, hosting and backup locations, and any transfer
safeguards before sharing. Keep hosted email enrichment and model providers
outside this review. Agree a deletion date and an owner for access, correction
and deletion requests. Verify cleanup for the source CSV, imported entries,
flags and exported copies, and record when backups expire.
[Groucho retention and deletion notes](../docs/backup-retention.md)

### Run the importer

Project admins can use **Import CSV** in Entries. Select a CSV and give the
export a stable source name, preview the validation result, then confirm to add
the rows to the selected project. The admin upload accepts up to 100 entries
per file. Use **Email flags** in any review tab to see existing or newly imported
submissions with exact email matches or known disposable domains.


```sh
pnpm import:presale
pnpm import:presale ./signups.csv --source event-export
```

Both commands validate locally. To write, set `GROUCHO_SANDBOX_URL` and
`GROUCHO_SANDBOX_API_KEY` in the shell for a dedicated sandbox project with an
open entry window, then repeat the command with `--apply`. The project attached
to the key receives the entries through `POST /v1/entries`. Keep the same source
name and registration IDs on retries. Existing rows are kept as first imported.
Use a different source name for a different export whose IDs may overlap.

Required CSV columns are `registration_id`, `email` and `signed_up_at`
(ISO 8601 UTC). Optional columns are `name`, `phone` and `connection_group`.
Use opaque, project-scoped identifiers in `connection_group`. Entries with
the same imported identifier appear together in **Shared connection**. Live
entries group by exact hashed address. The panel shows up to 50 submissions,
uses original CSV signup times and leaves existing flags and decisions separate. After importing the
fixture, open Entries in the target project, inspect the duplicate flags, review
entries and use the existing cohort CSV export. Fixture addresses are for
classification and review rehearsals only.

## Email tool watchlist

Reviewed 8 November 2026. Groucho uses the existing
[`disposable_email_domains` table](../supabase/migrations/20261027160000_cohorts_and_entries.sql)
with a [pinned disposable-only refresh](../supabase/migrations/20261108210754_refresh_disposable_email_domains.sql).
The refresh retains the existing seed and project dismissals and adds a
conservative selection of DNS-valid domains attributed to named temporary-inbox
providers. Exact address matches, known temporary
inbox providers and recognised privacy relays appear as distinct observations. Apple
generates random forwarding addresses and keeps the destination inbox private.
An unfamiliar local part or a relay label carries no adverse weight. Avoid
universal dot or plus-tag stripping. [Apple's relay documentation](https://support.apple.com/en-us/105078)

| Candidate | What to evaluate | Revisit when |
| --- | --- | --- |
| [disposable-email-domains](https://github.com/disposable/disposable-email-domains) | Local dataset with disposable-only and combined alias lists. The first refresh uses a selected subset of the disposable-only artifact. | Review a new revision when the export schema arrives or an operator finds a missed provider. |
| [mailchecker](https://github.com/FGRibreau/mailchecker) | Node package for temporary-inbox detection. Compare its classification and dependency footprint with loading a pinned dataset directly. | A maintained package would simplify dataset updates or materially improve coverage. |
| [Mailgun Email Validation](https://documentation.mailgun.com/docs/validate/oas/openapi-validate-final/bulk-validations) | Hosted CSV validation for invitation deliverability. | Sascha identifies bounced invitations as a problem worth measuring. |
| [IPQualityScore](https://www.ipqualityscore.com/documentation/email-validation-api/response-parameters) | Hosted reputation lookup with recent abuse and vendor risk signals. A [Node SDK](https://github.com/IPQualityScore/IPQSNodeSDK) is available. | Sascha has reviewed examples and wants to test whether reputation adds evidence beyond local signals. |

Recheck the watchlist when the export schema arrives and before selecting a
dependency. Record the candidate version or dataset revision, licence, update
cadence and fixture results. Compare false flags on relay and household cases and
incremental useful findings over exact matching. Before any hosted evaluation,
confirm permission to send addresses and check retention, region and per-batch
cost. Keep vendor outputs advisory and record unavailable results as unknown.
