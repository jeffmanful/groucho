# `next-groucho` example

Demonstrates **ADR-0001** (host proxy): the browser talks only to `/api/groucho/*`; the Next route handler forwards to the Groucho API with `GROUPCHO_API_KEY`.

## Run

This app includes its own `middleware.ts` (pass-through) so it does **not** pick up the parent repo’s authenticated middleware during `next build` in a workspace.

1. Start the main Groucho app (or any server that serves `POST /v1/sessions/{sessionId}/messages` with API key auth), e.g. on port **3000**.
2. From the repo root: `pnpm install`
3. `cd examples/next-groucho` and create `.env.local`:

   ```bash
   GROUPCHO_API_BASE_URL=http://127.0.0.1:3000
   GROUPCHO_API_KEY=gk_test_your_key
   ```

4. From the repo root: `pnpm run example:groucho` (or `cd examples/next-groucho && pnpm dev`) — the example listens on **3001** so it does not collide with the platform dev server on 3000.

Open [http://localhost:3001](http://localhost:3001) and use the embedded Gatekeeper.

The example displays the conversation experience; a terminal `passed`, `redirected`,
or `rejected` value is advisory. Production hosts should read `reviewStatus` and
only continue an approved flow with its matching access secret. Project suitability
thresholds and automatic actions are configured in Groucho, and both automatic
actions default off.
