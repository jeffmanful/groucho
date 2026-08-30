# `@groucho/sdk` — Package surface specification (v1)

**Package name (proposed):** `@groucho/sdk` (publish name TBD; may remain scoped `@postern/groucho` etc.)

**Consumers:** React 18+ apps first; other frameworks use the **REST contract** in [api/openapi.yaml](./api/openapi.yaml).

**Security default:** See [adr/0001-api-key-and-client-access.md](./adr/0001-api-key-and-client-access.md) — ship **server** and **browser** entry points with clear docs.

---

## 1. Package entry points

| Export path | Environment | Description |
|-------------|---------------|-------------|
| `@groucho/sdk` | universal | Types + `createClient` factory |
| `@groucho/sdk/react` | client | `Gatekeeper`, primitives, `GrouchoProvider` |
| `@groucho/sdk/server` | Node / Edge | `createServerClient` with secret key only |

> Build tooling: `package.json` **exports** map with `"browser"`, `"import"`, and `"react-native"` omitted until supported.

---

## 2. `createClient` (headless)

```ts
type GrouchoClientOptions = {
  /** Base URL of Groucho API, e.g. https://api.groucho.dev */
  baseUrl: string
  /** Project API key — use only on server per ADR-0001 */
  apiKey: string
  /** Optional fetch implementation (Edge, tests) */
  fetch?: typeof fetch
}

declare function createClient(options: GrouchoClientOptions): GrouchoClient

interface GrouchoClient {
  /** Send one chat turn; mirrors POST /v1/sessions/{sessionId}/messages */
  sendMessage(
    sessionId: string,
    input: { message: string; personaId?: string | null }
  ): Promise<PostMessageResponse>

  /** Optional: fetch session row */
  getSession?(sessionId: string): Promise<Session>

  /** Post-pass email — mirrors POST /v1/sessions/{sessionId}/access */
  submitAccessEmail?(
    sessionId: string,
    input: { email: string; secret?: string }
  ): Promise<void>
}
```

**Types:** Generated from [openapi.yaml](./api/openapi.yaml) via `openapi-typescript` (devDependency); published as part of package.

**Errors:** Throw `GrouchoApiError` with `{ status, code?, body }` for non-2xx.

---

## 3. React: `GrouchoProvider`

Wraps subtree that needs configuration without prop-drilling.

```tsx
type GrouchoProviderProps = {
  /** When set, children use hosted API directly (discouraged for live keys) */
  client?: GrouchoClient
  /** When set, SDK calls relative paths on the host (recommended) */
  proxyBasePath?: string // e.g. "/api/groucho" — host forwards with secret
  children: React.ReactNode
}
```

**Rules:**

- Provide **either** `client` **or** `proxyBasePath`, not both.
- `proxyBasePath` implies browser uses **cookie/session** to host; host attaches `gk_*`.

---

## 4. React: `<Gatekeeper />`

High-level embedded experience (message list + input + loading + outcome).

```tsx
type GatekeeperProps = {
  /** Opaque session id; persisted by host or by Gatekeeper in sessionStorage */
  sessionId?: string
  /** Called when session id is first created or resumed */
  onSessionId?: (id: string) => void
  /** Optional persona picker when project exposes multiple active personas */
  personaId?: string | null
  onOutcome?: (
    outcome: SessionOutcome,
    meta: { scores: ScoreBreakdown; secret?: string; profile?: Profile }
  ) => void
  /**
   * `profile` remains optional in the immediate terminal callback. Gatekeeper
   * extraction runs asynchronously after the neutral close is persisted; read the
   * completed session to retrieve it. The shape follows
   * `docs/profile-payload.schema.json`; see also `docs/profile-schema-guide.md`.
   */
  /** Slots for host branding */
  renderHeader?: () => React.ReactNode
  renderFooter?: () => React.ReactNode
  className?: string
  /** Accessibility: label for the transcript region */
  transcriptLabel?: string
}
```

**Built-in behaviour:**

- Manages `loading` / error states per turn.
- Disables input when session `status` is terminal (matches 409 handling: reset session on host policy).
- Uses design tokens (below) for default **dark** theme.

**Accessibility:**

- `role="log"` / `aria-live="polite"` on transcript.
- Focus management: return focus to input after assistant reply.

---

## 5. Primitives (exported for composition)

| Component | Role |
|-----------|------|
| `Transcript` | Scroll region + message bubbles |
| `MessageBubble` | `role`, `content`, optional metadata badge |
| `Composer` | Controlled input + submit on Enter |
| `OutcomeBanner` | Pass / redirect / reject messaging (copy configurable later via project) |
| `ThinkingIndicator` | Optional branded loading line |

Props mirror internal structure of [app/doorcheck/page.tsx](../app/doorcheck/page.tsx) where useful, without importing app code into the package.

---

## 6. Design tokens (default dark theme)

CSS variables set on a wrapping `.groucho-root` (or `data-theme="dark"`):

| Token | Default | Usage |
|-------|---------|--------|
| `--groucho-bg` | `#000000` | Surfaces |
| `--groucho-fg` | `rgba(255,255,255,0.92)` | Primary text |
| `--groucho-muted` | `rgba(255,255,255,0.55)` | Secondary |
| `--groucho-border` | `rgba(255,255,255,0.1)` | Inputs, dividers |
| `--groucho-accent` | `rgba(255,255,255,0.85)` | Focus ring |
| `--groucho-font-sans` | inherit | Match host or bundle Overused Grotesk later |

**v1:** Single bundled CSS `groucho.css` imported once. **v1.1:** Tailwind preset or unstyled headless variant.

---

## 7. Peer dependencies

```json
{
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "react-dom": "^18.0.0 || ^19.0.0"
  }
}
```

No `motion` peer unless Gatekeeper bundles animations — then declare optional peer or bundle.

---

## 8. Testing matrix (package CI)

| Case | Tooling |
|------|---------|
| Client against mock HTTP | msw |
| Gatekeeper a11y | jest-axe smoke |
| Types | `tsc --noEmit` on `examples/next` |

---

## 9. Monorepo placement (suggestion)

```
packages/sdk/
  src/
    client.ts
    react/
      Gatekeeper.tsx
      ...
  package.json
examples/next-groucho/
```

Does not block shipping from the same repo as the platform app.
