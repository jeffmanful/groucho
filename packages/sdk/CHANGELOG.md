# @groucho/sdk

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
