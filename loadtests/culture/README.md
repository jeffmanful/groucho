# Culture flow load tests

Run complete synthetic applications through the actual start and message route handlers, using local Supabase and a local Anthropic-compatible simulator. The initial scenario is the **Lewisham culture and live-music demo**, using the shared conversation engine. It does not exercise the private COLORS assessment pipeline.

There are no production application changes or new test endpoints. The harness runs in a separate Node process and binds its temporary services to loopback only.

## Run in the cloud without Docker

The manual [Culture load test workflow](../../.github/workflows/culture-load-test.yml) runs the Node harness and synthetic AI on a GitHub Actions runner against an isolated hosted Supabase database. Your computer needs no Docker images, local database or build output.

This mode tests the actual handlers on the cloud runner and a real hosted staging database. It does **not** send load through a deployed Vercel preview. Full Vercel/relay/edge capacity requires an additional staging deployment test.

Before enabling the workflow:

1. Provision an isolated Supabase branch/project with the Groucho schema. A Vercel preview is not proof of database isolation. A branch may incur compute and usage charges.
2. Create a GitHub environment named `loadtest-staging`, restrict it to reviewed `main`, and configure required reviewers before storing its service key.
3. Add environment variables `LOADTEST_STAGING_PROJECT_REF` and `LOADTEST_SUPABASE_URL`, where the URL is exactly `https://<staging-ref>.supabase.co`.
4. Add the isolated branch's service key as the environment secret `LOADTEST_SUPABASE_SERVICE_KEY`. Never paste it into chat, source, inputs or reports.
5. Publish the reviewed workflow and scripts, then manually dispatch **Culture load test** from `main`. Choose 100 or 200 applicants, a gradual ramp or burst, and optionally five minutes of sustained demand.

The workflow runs a two-applicant smoke test first, stops if it fails, and uploads JSON reports for seven days. Only one staging load run executes at a time. The normal workflow does not run on pushes or pull requests and cannot use an arbitrary dispatch branch to obtain its environment secret.

Staging mode requires the explicit `--staging` flag and a matching project reference. The known live Groucho database is denied even if selected in configuration. All model calls remain local to the runner, with dummy credentials and no real-provider fallback. Fetch redirects are rejected to prevent the database allowlist from being bypassed.

To use the same staging mode from a small local Node process instead of Actions:

```sh
node --import tsx loadtests/culture/run.ts --staging --users 100
```

This needs the three staging environment settings above, but no Docker. Hosting, database and Actions usage can still have costs; simulated AI avoids model charges.

## Recorded staging results

[5 November 2026 results](../reports/2026-11-05/README.md): both 100- and 200-applicant runs passed against a temporary hosted branch, which was deleted afterward. These used a local Node runner and do not measure a Vercel deployment.

## What a run does

Each virtual applicant starts a new session, gives six answers, resumes the same session after answer two, and completes the conversation. Answers cover discovery, companion, location, tour-night preference, cultural connection and other interests. The simulator returns grounded facts in the model's existing tool-response format; it does not bypass route handling, validation or conversation persistence.

The run verifies stored session/message counts and confirms that no completion jobs were queued. Synthetic demo completion is not approval, allocation or checkout. All identities use `example.invalid` addresses.

## Billing and data isolation

- Default mode accepts only explicit loopback IP service URLs. Staging mode additionally accepts exactly the configured hosted Supabase branch. Other remote targets and `localhost` DNS names are rejected.
- The launcher does **not** load `.env`, `.env.local` or Next's environment loader. Supply a separate local database key through `LOADTEST_SUPABASE_SERVICE_KEY`.
- Before application imports, inherited provider settings are removed and Anthropic receives a dummy credential and a local base URL.
- An allowlist blocks application `fetch` calls to anything except the selected test database, synthetic provider and temporary application listener. There is no fallback to a real model provider. This is a fetch guard, not an operating-system network sandbox.
- The simulator reports zero billable tokens. Its delay and jitter imitate waiting for a model, not model reasoning quality or real provider capacity.
- Each run creates a uniquely named organisation, project, persona and conversations-scoped key. Normal shutdown removes only those generated fixtures. Existing projects are never reconfigured.
- If the process is forcibly terminated, inspect local organisations with a `loadtest-` slug and remove only the abandoned test organisation; its owned persona and project data cascade. Do not run this against a production database tunnel.

## Prerequisites

Use Node and the repository's installed dependencies. No k6 installation is required.

Start Docker and local Supabase with the repository migrations applied. Check your installed CLI's `supabase --help`, `supabase start --help` and `supabase status --help` before using its commands. Do not reset a database containing work you need to keep. The checked-in config references a seed file that may be absent; resolve local startup/seeding separately rather than resetting an existing database blindly.

Retrieve your **local** service-role/secret key from local Supabase status, then set it in your shell without committing it:

```sh
export LOADTEST_SUPABASE_URL=http://127.0.0.1:54321
export LOADTEST_SUPABASE_SERVICE_KEY='your-local-service-key'
```

No live Anthropic credential is needed. Do not use the application's regular environment file.

## Run scenarios

Start with a small smoke test:

```sh
pnpm loadtest:culture --users 2 --ramp 0 --think-ms 100 --ai-delay-ms 50 --ai-jitter-ms 0
```

Then ramp up to 100 and 200 applicants. The default is one conversation per applicant, a 20-second ramp, approximately three seconds of thinking per answer and 1.5–2 seconds of simulated model latency:

```sh
pnpm loadtest:culture:100
pnpm loadtest:culture:200
```

Simultaneous opening burst:

```sh
pnpm loadtest:culture:200 --ramp 0
```

Sustained 200-user workload for ten minutes; workers start another application after completing the previous one until the duration ends:

```sh
pnpm loadtest:culture:200 --duration 600 --ramp 30 --think-ms 10000
```

Applications already started are allowed to finish after the duration. Ramp time is included in the duration; choose a duration longer than the ramp when testing a steady plateau. Small jitter in thinking time avoids perfectly synchronized turns. `--ramp 0` deliberately concentrates starts.

If the pnpm shim tries to download a package-manager version, invoke the installed dependencies directly:

```sh
node --import tsx loadtests/culture/run.ts --users 200 --ramp 0
```

## Rate limits and slower models

The isolated capacity run sets the API-key limit to 100,000 messages/minute so the normal 60/minute default does not hide the underlying capacity. The per-session limit remains 30/minute. This applies only to the harness process, never to a running application.

To check throttling, retain a normal-sized limit:

```sh
pnpm loadtest:culture:100 --ramp 0 --rate-limit 60
```

Expect 429 responses, incomplete conversations and a nonzero exit in this scenario. This demonstrates the current limiter; it is not a capacity pass. The current limiter is process-local, so this does not verify a distributed limit. Failed starts/messages are not retried as if they succeeded.

Increase simulated latency to model a slower upstream:

```sh
pnpm loadtest:culture:200 --ai-delay-ms 5000 --ai-jitter-ms 2000
```

## Reports and interpretation

Reports are saved under ignored `loadtests/results/culture-<timestamp>-<users>.json` and their paths are printed. They include:

- Started/completed/failed conversations, resume checks, request errors and 429 responses.
- Successful start, message and resume latency at p50/p95/p99; full conversation duration includes thinking time.
- Peak active conversations and simultaneous synthetic model requests.
- Exact persisted session/message counts, completion-job count and integrity result.
- Blocked external fetch attempts and simulator rejections.

A normal run passes only with complete conversations, no request/contract errors, matching persistence counts, no completion jobs, no simulator rejections and no blocked egress. The harness exits nonzero otherwise. It does not silently treat rate-limited or prematurely completed applications as successful.

`peakActive` measures conversations between start and completion, including thinking time. `simulatedAi.peakActive` measures in-flight model requests. These are different capacity figures. Latency percentiles cover successful responses; failure counts are reported separately.

No latency SLA is assumed. Compare runs with the same delays/thinking times, inspect tail latency, database/host resource usage and errors, then choose an operating envelope with headroom.

## Scope of the evidence

The runner wraps the real API handlers in a small Node HTTP server. It measures those handlers and local Supabase with simulated AI. It does **not** include Next production hosting, Proxy, the client relay, CDN/waiting room, browser rendering, network geography, real Anthropic rate limits or report generation. The public message route returns JSON; its full response duration is not a browser time-to-first-token metric. The simulator separately supports provider streaming for protocol verification.

To establish deployment capacity, repeat a separately protected, synthetic-provider setup through the full staging host/relay with realistic database sizing and distributed traffic. Never interpret a laptop result as production launch capacity.

## Verify the harness without Docker

```sh
node node_modules/vitest/vitest.mjs run loadtests/culture
```

The verification suite uses an **in-memory PostgREST adapter** and the real application handlers. It checks 2, 100 and 200 concurrent applicants, state preservation, all six turns, grounded completion, fixture cleanup, SDK compatibility, streaming and outbound blocking. This verifies the harness without paid services; it is not a real database load benchmark.
