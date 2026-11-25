# @groucho-gatekeeper/sdk

## 0.2.0

### Minor Changes

- 25054e7: Add optional artist intake to Gatekeeper and GatekeeperV2, plus the reusable ArtistIntakeForm. Collect name, city and age with email, and optional artist name, social links and music streaming links. Keep artist application attempts separate from email-only attempts in session storage and carry structured applicant details through the API contract.

  Use the same expanded intake for normal community applications by default, retaining their community conversation. Store and hand off contact/onboarding details separately from the artist audience. Hosts needing legacy intake must opt into `intakeMode="email"`.

  Expose neutral evidence limits separately from material decision gaps in reviewer reports.

- e0eea09: Ask users whether to continue an active session or start over with a fresh session id before restoring the saved conversation. Improve response waits with delayed reassurance, answer-preserving retry, and a softer outgoing-question transition.
- 635870f: Add createGrouchoApplicantRelay for browser-bound session ownership and private assessment filtering. Keep reports, profiles, suitability, decisions and access secrets out of applicant responses. GatekeeperV2 can opt into restoreSession to recover saved intake and the actual neutral close after refresh without creating a second application. Hosts can supply a validated invitation grant to bind all reads and writes to one assigned conversation; `lockApplicantEmail` keeps invited intake recipients fixed.
- 7d987bb: Treat the `completed` session outcome as terminal in `Gatekeeper`, `GatekeeperV2` and `isTerminalOutcome`. The newer COLORS conversation engine finishes conversations with `completed` instead of passed/redirected/rejected, and sends a neutral placeholder for per-turn `scores`; its suitability score and reviewer report follow on the completed session and webhook. Hosts running COLORS projects must upgrade before those projects are switched to the newer engine.
- b5bd181: Add `signalEvidencePending` to shared-engine message responses. Open-style conversations now reply as soon as the reply is written and save that answer's evidence review straight afterwards. A continuing turn may return `signalEvidencePending: true`, with `signalEvidence` covering the applicant's earlier answers. The next turn and the closing turn include this answer.
- a11abfe: Add the `none_identified` signal evidence status. It marks a signal the applicant answered with "nothing applies" (a plain no, nothing comes to mind, or not yet), as distinct from `declined`, which now means only that they chose not to share.

## Unreleased

### Added

- `createGrouchoRelay` (in `@groucho-gatekeeper/sdk/server`): a relay for your browser-facing route that keeps the
  key on your server, only reaches applicant-facing endpoints, never forwards cookies, and passes on the
  applicant's IP, user agent and language. `applicantFromRequest` and an `applicant` option on
  `sendMessage`, `startSession` and `submitEntry` do the same for calls you make from your server.
- `listApplications`, `getApplication` and `decideApplication` for reviewing applications from
  your own app. They need an applications-scoped API key and must run on your server.
- `correctApplication` to correct a decision (the old one stays in the history) and
  `reportOutcome` to tell Groucho whether approved people were invited, joined and took part.
- `submitEntry` for drop entries without a conversation (email, phone, socials, drop fields).
- `listCohorts` and `addToCohort` for reading cohorts and reporting the winners of a ballot you
  ran yourself. Types: `Cohort`, `CohortList`, `SubmitEntryRequest`, `SubmitEntryResponse`,
  `AddToCohortRequest`, `AddToCohortResponse`.
- `decideApplication` accepts `applicantReason`, a reason you may share with the applicant.
- `getApplication` returns the decision history and reported outcomes.
- Types: `Application`, `ApplicationList`, `ApplicationDetail`, `ApplicationQueue`,
  `ApplicationDecisionSummary`, `DecideApplicationRequest`, `DecideApplicationResponse`,
  `ListApplicationsQuery`.

### Changed

- Generated response types now include client decision state, final suitability
  score, suitability band, and the automatic-approval secret where applicable.
- Documented that terminal outcomes are advisory and `reviewStatus` is the
  authoritative application-decision state.

## 0.1.1

### Patch Changes

- 4095771: Initial
- Update intro logic
- e701c66: Groucho v1

Changelog. Format roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## 0.1.0

Initial public release.

### Added

- `createClient(options)` headless client (`sendMessage`, `getSession`, `submitAccessEmail`).
- `createServerClient(options)` server-only variant that requires `apiKey`.
- `GrouchoApiError` thrown on non-2xx with `.status` and `.body`.
- React entry (`@groucho-gatekeeper/sdk/react`):
  - `GrouchoProvider` — supports either a `client` instance or a `proxyBasePath` (recommended for browsers; see ADR-0001).
  - `Gatekeeper` — batteries-included door conversation component.
  - Primitives: `Transcript`, `MessageBubble`, `Composer`, `OutcomeBanner`, `ThinkingIndicator`.
  - `useGroucho()` hook.
- Default dark theme at `@groucho-gatekeeper/sdk/groucho.css` exposing `--groucho-*` CSS variables.
- Types generated from the live OpenAPI contract (`PostMessageResponse`, `Session`, `ScoreBreakdown`, `SessionOutcome`, `Profile`, `ProfileCore`, `ProfileExtraction`).
- `onOutcome(outcome, meta)` carries `meta.profile` on terminal turns when the project has profile extraction enabled. See [`profile-schema-guide.md`](https://github.com/jeffmanful/groucho/blob/main/docs/profile-schema-guide.md).

### Build

- ESM only, with `.d.ts`. Subpath exports for `.`, `./react`, `./server`, `./groucho.css`, `./package.json`.
- React 18 and 19 supported via peer dependency.
- Node ≥ 18.17 required.
