# @groucho-gatekeeper/sdk

Headless TypeScript client, server relays and React UI for Groucho. This README describes repository source; check the installed release exports before using newer helpers. Backend deployment does not publish or upgrade a consumer SDK.

## Install and entry points

```bash
pnpm add @groucho-gatekeeper/sdk
```

React 18/19 are declared peers; the package is ESM. See [package.json](package.json) for exact exports/engine requirements and [CHANGELOG](CHANGELOG.md) for release history.

- `@groucho-gatekeeper/sdk`: headless client, errors and types.
- `@groucho-gatekeeper/sdk/react`: providers, Gatekeeper/GatekeeperV2, intake and rendering components.
- `@groucho-gatekeeper/sdk/server`: server client and relay helpers.
- `@groucho-gatekeeper/sdk/groucho.css`: scoped stylesheet.

## Browser apps: keep project keys on the host server

Use a conversations key in a same-origin relay, never a `NEXT_PUBLIC_` key. This generic relay restricts applicant paths and forwards connection context; the host still owns authentication/session ownership:

```ts
import { createGrouchoRelay } from "@groucho-gatekeeper/sdk/server"

const relay = createGrouchoRelay({
  baseUrl: process.env.GROUCHO_API_BASE_URL!,
  apiKey: process.env.GROUCHO_API_KEY!,
})

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return relay(req, (await ctx.params).path)
}
export const POST = GET
```

`createGrouchoApplicantRelay` additionally binds sessions with an ownership cookie, filters request fields and exposes a strict applicant response allowlist, with optional server-resolved invitation binding. Its current allowlist does not preserve public-demo engine/details/completion fields; use the demos' custom proxy/validator for that contract.

```tsx
"use client"
import "@groucho-gatekeeper/sdk/groucho.css"
import { GrouchoProvider, GatekeeperV2 } from "@groucho-gatekeeper/sdk/react"

export function Application() {
  return (
    <GrouchoProvider proxyBasePath="/api/groucho">
      <GatekeeperV2 />
    </GrouchoProvider>
  )
}
```

The current source supports expanded community/artist intake, explicit resume and terminal `completed`. A released version can differ: adopt/build a compatible version before switching a host to a newer engine. A terminal callback is not approval or proof that asynchronous assessment is ready.

## Server/headless usage

```ts
import { createServerClient } from "@groucho-gatekeeper/sdk/server"

const client = createServerClient({
  baseUrl: process.env.GROUCHO_API_BASE_URL!,
  apiKey: process.env.GROUCHO_API_KEY!,
})
const sessionId = crypto.randomUUID()
await client.startSession(sessionId, { applicant: { email: "synthetic@example.com" } })
await client.sendMessage(sessionId, { message: "I would like to explore the community." })
```

Hosts own each application attempt ID and its authorised resume/restart policy. Failed network responses are not an exactly-once guarantee; use the saved state and host ownership rules when recovering.

## Outcomes, profiles and privacy

`SessionOutcome` includes `active`, `passed`, `redirected`, `rejected`, `completed`. Newer COLORS conversations finish without a model decision and send neutral per-turn scores; their private report, profile and suitability follow asynchronously. Read the authorised session/assessment flow for persisted results.

Approval/decline comes from a reviewer or enabled deterministic policy. Use `reviewStatus` and matching approval/allocation authority, not a score or `passed` token. Public persona simulations finish with `completion.mode: simulation` and `reviewStatus: not_required`; they do not submit real applications.

The shared engine's immediate `profile` field is a **string profile ID**, whereas standard/session extraction uses a **profile object**. The OpenAPI shared-response schema documents that distinction. Existing client response aliases are not automatic support for the custom demo contract; narrow it explicitly or use the demo website controller. Never read an ID string as an extracted applicant profile.

Keep reports, real scores, reviewer notes, decisions and secrets out of applicant relays. `createGrouchoRelay` is a general transport, not a private-field filter; use an appropriate strict relay or host response contract.

## Server review and allocation

Use an applications-scoped key only after authenticating/authorising the reviewer on your server. Source methods include list/get/decide/correct applications, reporting outcomes, and cohort reads/membership updates. Conversations keys cannot call review methods. A correction creates a new auditable decision rather than editing history.

Subscribe to the actual signed events your host consumes, verify raw-body HMAC and deduplicate IDs. Completion, decision, correction and allocation are different events. Your product owns invitation emails, accounts, inventory and fulfilment.

## Reference and verification

- [SDK surface and version boundaries](../../docs/sdk-surface.md).
- [Client integration](../../docs/client-integration-guide.md), [decision policy](../../docs/client-decision-policy.md), [API-key ADR](../../docs/adr/0001-api-key-and-client-access.md).
- [OpenAPI](../../docs/api/openapi.yaml), [profile schema](../../docs/profile-payload.schema.json), [profile authoring](../../docs/profile-schema-guide.md).
- [Next.js example](../../examples/next-groucho/README.md) and [runtime map](../../docs/architecture.md).

From the repo root run `pnpm run sdk:build` and `pnpm run sdk:test`; the package also has `typecheck`. Regenerate types after OpenAPI edits. Pin/adopt an intended release, then verify your deployed host end to end; historical changelog claims are not evidence that its installed version was upgraded.
