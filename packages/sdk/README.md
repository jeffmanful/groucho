# `@groucho/sdk`

Headless TypeScript client, server helper, and React UI for the [Groucho](https://github.com/thompson-mcdonald/groucho) gatekeeper API.

Groucho is a conversational doorman: it qualifies a user across 3–5 short turns and emits one of three terminal outcomes (`passed`, `redirected`, `rejected`) plus a structured `profile` payload extracted from the conversation. Use this SDK to drop the conversation UI into a React app, or to call the JSON API directly from any TypeScript runtime.

- API contract: [`docs/api/openapi.yaml`](https://github.com/thompson-mcdonald/groucho/blob/main/docs/api/openapi.yaml)
- Deeper surface notes: [`docs/sdk-surface.md`](https://github.com/thompson-mcdonald/groucho/blob/main/docs/sdk-surface.md)
- Client integration guide: [`docs/client-integration-guide.md`](https://github.com/thompson-mcdonald/groucho/blob/main/docs/client-integration-guide.md)
- Profile contract: [`docs/profile-payload.schema.json`](https://github.com/thompson-mcdonald/groucho/blob/main/docs/profile-payload.schema.json)
- Reference example: [`examples/next-groucho`](https://github.com/thompson-mcdonald/groucho/tree/main/examples/next-groucho)

## Install

```bash
npm install @groucho/sdk
# or
pnpm add @groucho/sdk
# or
yarn add @groucho/sdk
```

React 18 or 19 is a peer dependency. The package ships as ESM only; Node ≥ 18.17 (matches Next.js 14/15/16).

## Two modes

The Groucho API authenticates with a `Bearer gk_*` project API key. **That key must never reach the browser.** The SDK supports two patterns ([ADR-0001](https://github.com/thompson-mcdonald/groucho/blob/main/docs/adr/0001-api-key-and-client-access.md)):

### 1. Host proxy (recommended for browser apps)

Mount a proxy route on your own origin that forwards to Groucho with the secret key attached server-side. The browser only talks to your own domain.

```ts
import { NextRequest, NextResponse } from "next/server"

async function proxy(req: NextRequest, pathSegments: string[]) {
  const base = process.env.GROUPCHO_API_BASE_URL!.replace(/\/$/, "")
  const url = new URL(`${base}/${pathSegments.join("/")}`)
  url.search = req.nextUrl.search

  const headers = new Headers(req.headers)
  headers.delete("host")
  headers.set("Authorization", `Bearer ${process.env.GROUPCHO_API_KEY}`)

  const init: RequestInit = { method: req.method, headers }
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer()
  }
  return fetch(url, init).then(
    (res) => new NextResponse(res.body, { status: res.status, headers: res.headers }),
  )
}

export const GET = (req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) =>
  ctx.params.then(({ path }) => proxy(req, path))
export const POST = (req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) =>
  ctx.params.then(({ path }) => proxy(req, path))
```

Then in the browser:

```tsx
"use client"

import "@groucho/sdk/groucho.css"
import { GrouchoProvider, Gatekeeper } from "@groucho/sdk/react"

export function Door() {
  return (
    <GrouchoProvider proxyBasePath="/api/groucho">
      <Gatekeeper
        transcriptLabel="Door conversation"
        onOutcome={(outcome, meta) => {
          console.log(outcome, meta.scores, meta.secret, meta.profile)
        }}
      />
    </GrouchoProvider>
  )
}
```

A complete working example lives in [`examples/next-groucho`](https://github.com/thompson-mcdonald/groucho/tree/main/examples/next-groucho).

### 2. Server-only client

For server actions, scheduled jobs, or pure-backend integrations, call Groucho directly with the key:

```ts
import { createServerClient } from "@groucho/sdk/server"

const groucho = createServerClient({
  baseUrl: "https://groucho.example.com",
  apiKey: process.env.GROUPCHO_API_KEY!,
})

const res = await groucho.sendMessage("sess_abc", {
  message: "Hi.",
  applicant: { email: "applicant@example.com", name: "Applicant Name" },
})
if (res.status !== "active") {
  // res.profile carries the extracted profile on terminal turns
}
```

## React API

```tsx
import {
  GrouchoProvider,
  Gatekeeper,
  Transcript,
  Composer,
  OutcomeBanner,
  ThinkingIndicator,
  MessageBubble,
  useGroucho,
} from "@groucho/sdk/react"
```

`<Gatekeeper />` is the batteries-included component. Its props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `sessionId` | `string` | auto-generated `crypto.randomUUID()` | Persisted in `sessionStorage` per page. |
| `onSessionId` | `(id: string) => void` | — | Notified once the session id is decided. |
| `personaId` | `string \| null` | `null` | Optional persona override; must belong to the project and be active. |
| `applicant` | `{ email: string; name?: string }` | — | First-class applicant identity. When omitted, the default UI asks for email before chat. Hosts may still provide a known name. |
| `collectApplicant` | `boolean` | `true` | Set `false` only when the host app has already collected identity elsewhere. |
| `onOutcome` | `(outcome, { scores, secret?, profile?, applicant? }) => void` | — | Fires once when the session reaches a terminal state. |
| `renderHeader` / `renderFooter` | `() => ReactNode` | — | Slots for host branding. |
| `className` | `string` | — | Appended to the root `groucho-root groucho-gatekeeper` class list. |
| `transcriptLabel` | `string` | — | aria-label for the transcript region. |
| `confirmResume` | `boolean` | `true` | When an active session is restored, show Continue and Start over before revealing its last question. |

Both `<Gatekeeper />` and `<GatekeeperV2 />` use the same explicit resume checkpoint.
Choosing **Start over** creates a fresh session id, keeps the supplied applicant identity,
and calls `onSessionId` with the replacement id. The earlier partial session is preserved
for audit and abandonment reporting.

While an answer is being processed, both components show a short thinking state and switch
to a reassuring message after six seconds. Failed submissions retain the exact answer and
offer an explicit **Retry answer** action. `<GatekeeperV2 />` also softens the outgoing
question away as soon as the answer is submitted.

`onOutcome` receives the response body of the terminal turn. Profile extraction runs after
the response so terminal screens are not held up by profile and webhook work. Use
`getSession(sessionId)` to retrieve the persisted profile once completion finishes.

See [`profile-schema-guide.md`](https://github.com/thompson-mcdonald/groucho/blob/main/docs/profile-schema-guide.md) for the schema authoring contract.

If you want to compose your own UI, use the primitives (`Transcript`, `Composer`, …) and drive them with `useGroucho()` which returns the underlying `GrouchoClient`.

## Headless client

```ts
import { createClient, GrouchoApiError } from "@groucho/sdk"

const groucho = createClient({
  baseUrl: "/api/groucho", // your proxy path, or absolute API origin
  // apiKey: "gk_test_..."  // ONLY in non-browser code
})

try {
  const res = await groucho.sendMessage("sess_abc", {
    message: "Hi.",
    applicant: { email: "applicant@example.com" },
  })
} catch (e) {
  if (e instanceof GrouchoApiError && e.status === 409) {
    // session already concluded — start a new one
  }
  throw e
}

const session = await groucho.getSession("sess_abc")
await groucho.submitAccessEmail("sess_abc", {
  email: "user@example.com",
  secret: session.secret,
})
```

### Typed responses

All response types are generated from the live OpenAPI spec. Useful exports:

- `PostMessageResponse` — `sendMessage` return
- `Session` — `getSession` return
- `SessionOutcome` — `"active" | "passed" | "redirected" | "rejected"`
- `ScoreBreakdown` — `specificity` / `authenticity` / `cultural_depth` / `overall`
- `Profile`, `ProfileCore`, `ProfileExtraction` — extracted profile shape
- `GrouchoApiError` — thrown on non-2xx; has `.status`, `.body`

You can also pull raw OpenAPI artifacts:

```ts
import type { components, operations, paths } from "@groucho/sdk"
```

## Styling

Import the default dark theme once at the root of your app:

```ts
import "@groucho/sdk/groucho.css"
```

It's a single stylesheet scoped under `.groucho-root` exposing CSS variables you can override:

```css
.groucho-root {
  --groucho-bg: #0a0a0a;
  --groucho-fg: #f5f5f5;
  --groucho-muted: #888;
  --groucho-border: #2a2a2a;
  --groucho-accent: #ffffff;
  --groucho-font-sans: "Inter", system-ui, sans-serif;
  --groucho-error: #f87171;
}
```

Skip the import and write your own CSS if you want full control — every primitive ships with stable, unprefixed class names (`groucho-transcript`, `groucho-composer`, etc.).

## Environment & security checklist

- ✅ Keep `gk_*` API keys on the server.
- ✅ Use `proxyBasePath` in the browser; use `apiKey` only in `createServerClient`.
- ✅ Rotate the key when a developer leaves — admin UI has a one-click rotate.
- ✅ Verify webhook signatures with the HMAC secret if you also process `session.completed`.

## Versioning

This package follows semver. Pre-1.0 minor bumps may include breaking changes; pin to a minor (`^0.1.0`) and read [`CHANGELOG.md`](./CHANGELOG.md).

## License

[MIT](./LICENSE)
