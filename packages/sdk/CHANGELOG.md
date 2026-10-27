# @groucho/sdk

## Unreleased

### Added

- `createGrouchoRelay` (in `@groucho/sdk/server`): a relay for your browser-facing route that keeps the
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
- React entry (`@groucho/sdk/react`):
  - `GrouchoProvider` — supports either a `client` instance or a `proxyBasePath` (recommended for browsers; see ADR-0001).
  - `Gatekeeper` — batteries-included door conversation component.
  - Primitives: `Transcript`, `MessageBubble`, `Composer`, `OutcomeBanner`, `ThinkingIndicator`.
  - `useGroucho()` hook.
- Default dark theme at `@groucho/sdk/groucho.css` exposing `--groucho-*` CSS variables.
- Types generated from the live OpenAPI contract (`PostMessageResponse`, `Session`, `ScoreBreakdown`, `SessionOutcome`, `Profile`, `ProfileCore`, `ProfileExtraction`).
- `onOutcome(outcome, meta)` carries `meta.profile` on terminal turns when the project has profile extraction enabled. See [`profile-schema-guide.md`](https://github.com/thompson-mcdonald/groucho/blob/main/docs/profile-schema-guide.md).

### Build

- ESM only, with `.d.ts`. Subpath exports for `.`, `./react`, `./server`, `./groucho.css`, `./package.json`.
- React 18 and 19 supported via peer dependency.
- Node ≥ 18.17 required.
