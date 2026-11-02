# ADR 0001: project keys stay on the server

Status: implemented integration boundary; reviewed 2 November 2026. Supersedes the original draft's browser-direct key and hypothetical token recipes.

## Decision

Browsers call a same-origin host relay. The relay stores a conversations-scoped `gk_*` project key server-side, limits routes/methods, derives applicant connection context from trusted hosting metadata, and forwards requests to Groucho. Browser bundles, public environment variables and storage must not contain that key.

Use `createGrouchoRelay` from `@groucho-gatekeeper/sdk/server` for the supported applicant endpoint relay. Use `createGrouchoApplicantRelay` when the host needs its session-ownership cookie and a strict applicant response allowlist; invitation-aware integration uses the assigned server-resolved grant. The latter currently strips public-demo `engine`/`details`/`completion` fields, so it is not a drop-in replacement for the custom public-demo controller.

The generic relay restricts paths but is not a substitute for host user authentication or session ownership. A host must enforce its own permissions. Applications-scoped keys can read/decide applications and belong only in authorised server review handlers, never in browser-facing relays.

## What is not the contract

There is no required Groucho-issued short-lived applicant token exchange at `POST /v1/sessions`. Use the implemented `/v1/sessions/{id}/start` and message/read routes. Application invitation tokens are a separate implemented capability; they do not make exposing the project key safe. A test key is still a server credential, not a public browser key.

## Reference implementations

- [SDK relay source](../../packages/sdk/src/relay.ts) and [applicant relay](../../packages/sdk/src/applicant-relay.ts).
- [Client integration](../client-integration-guide.md) and [SDK surface](../sdk-surface.md).
- [Next.js example](../../examples/next-groucho/README.md).
- Public `groucho-demos` uses a custom brand/key proxy and explicit demo response validator; see its repository documentation.

Logs must not contain credentials or full authorisation headers. Match upstream content encoding/length to the body actually forwarded, use no-store where appropriate, and preserve retry/error semantics. See [security review](../security-review-checklist.md).
