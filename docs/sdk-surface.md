# SDK surface and adoption

Current source guide, reviewed 2 November 2026. The package is **`@groucho-gatekeeper/sdk`**, as declared in [package.json](../packages/sdk/package.json), not the earlier proposed `@groucho-gatekeeper/sdk` name. See the [SDK README](../packages/sdk/README.md) for usage.

| Entry | Source authority / purpose |
| --- | --- |
| `@groucho-gatekeeper/sdk` | `packages/sdk/src/index.ts`: headless client, errors and generated/public types |
| `@groucho-gatekeeper/sdk/react` | `src/react/index.ts`: providers, Gatekeeper/GatekeeperV2, intake, transcript/composer and interaction components |
| `@groucho-gatekeeper/sdk/server` | `src/server.ts`: server client, general relay and session-owned applicant relay |
| `@groucho-gatekeeper/sdk/groucho.css` | Scoped stylesheet and documented custom properties |

## Version boundary

This guide describes repository source. A package version already installed in another application may not export every helper here. Building/deploying the backend does not publish an SDK or upgrade a consumer. Check the installed version, release notes and actual exports; build/adopt a compatible release before enabling a new engine in a host.

The `colors-completed-outcome` changeset covers treating `completed` as terminal. Older consumers that only handle passed/redirected/rejected can leave the composer open. The public demo website uses a custom controller/validator instead of waiting for an SDK publication.

## HTTP types and responses

OpenAPI is [docs/api/openapi.yaml](api/openapi.yaml); generated TypeScript is `packages/sdk/src/generated/openapi.ts`. Run SDK code generation/build after schema edits rather than manually maintaining duplicate types.

`SessionOutcome` includes active, passed, redirected, rejected and completed. A terminal conversation does not establish approval. Real application decisions use `reviewStatus`; public simulation message responses instead use `not_required` at close.

The shared runtime's `profile` response property is a **string profile ID**, while standard message/session contracts use `profile` for an extracted **object**. The separate shared-response schema documents this existing wire distinction. Do not treat a demo/profile ID as an extracted applicant profile. Use the custom demo contract or explicitly narrow the response; retrieve real extracted data from the authorised session/reviewer flow after completion.

## Relays

`createGrouchoRelay` restricts applicant paths and attaches a server-held conversations key. It is not session ownership/authentication by itself. `createGrouchoApplicantRelay` adds an ownership cookie, request filtering and a strict response allowlist for applicant integrations, including server-resolved invitations. Its current allowlist does not preserve public-demo engine/details/completion fields; it is not a drop-in demo relay.

Applications keys and methods such as list/get/decide/correct/reportOutcome belong in authorised server review handlers. The browser-facing path must not expose them. See [API-key ADR](adr/0001-api-key-and-client-access.md).

## Verification

From the repository root, run `pnpm run sdk:build` and `pnpm run sdk:test`; the package also provides `typecheck`. Test the actual host for resume, completed closure, error recovery and private report boundaries. Do not carry forward the retired proposal's hypothetical tooling, token exchange or browser-key support as shipped capabilities.
