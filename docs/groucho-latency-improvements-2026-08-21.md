# Groucho latency improvements — 21 August 2026

## Outcome

The conversation-quality path remains one Claude Haiku 4.5 call with the existing
persona, adaptive state, bridges, evidence checks, and deterministic response
repairs. Latency work has been applied around that path rather than by reducing
Groucho's conversational judgment.

Live verification now confirms the completion-job migration is deployed in the
configured hosted test project. The runtime deliberately falls back to inline
completion when the queue is unavailable, preserving correctness at the cost of the
previous terminal latency.

## Implemented sequence

### 1. Stage timing

Every gatekeeper message now records a `request_timing` log with:

- project resolution;
- session lookup;
- persona resolution;
- user persistence;
- history loading;
- conversation model time;
- assistant persistence;
- terminal state persistence;
- completion-job enqueue or inline fallback;
- total request time.

Development responses also include a `Server-Timing` header. No applicant answers,
identity, or other private content is included in timing data.

### 2. Durable terminal completion

After the neutral close and terminal session state are persisted, the request now
enqueues a `session_completion_jobs` record and returns. The durable worker handles:

- profile extraction;
- profile persistence;
- verdict creation;
- webhook preparation and delivery retry;
- cultural-signal persistence.

Jobs are claimed atomically with `FOR UPDATE SKIP LOCKED`, retried with exponential
backoff, and reclaimable if a worker stops while processing. An immediate Next.js
post-response drain handles the normal case; the cron route remains the durable
retry path.

The existing `GET /api/cron/webhook-deliveries` route now drains completion jobs
before webhook deliveries. `GET /api/cron/session-completions` is also available as
a completion-only worker endpoint. Both require `Authorization: Bearer $CRON_SECRET`.

### 3. Anthropic prompt caching

The stable system prefix is sent as an explicit ephemeral cache block. The visible
reply contract, tool schema, compact application state, and model remain unchanged.
Cache effectiveness is visible through `cacheCreationInputTokens` and
`cacheReadInputTokens` in existing `llm_usage` logs.

### 4. Configuration caching

Normalized project settings and active persona records use a 60-second in-process
cache. Project and persona admin mutations explicitly invalidate the local cache.
The TTL limits staleness across separate server instances where process-local
invalidation cannot propagate.

API-key validation, session state, message history, reviewer evidence, and human
decisions are not cached.

## Deployment requirements

1. Apply `20260821100000_add_session_completion_jobs.sql` through the normal
   Supabase migration deployment in every target environment; the configured hosted
   test project is confirmed migrated.
2. Keep `CRON_SECRET` configured.
3. Schedule `GET /api/cron/webhook-deliveries` at the existing worker interval.
4. Confirm completion jobs reach `completed` and terminal profiles appear shortly
   after the applicant receives the close.
5. Compare p50 and p95 `request_timing.timingsMs.total` and
   `conversation_model` before making further prompt or output reductions.

## Quality safeguards retained

- No model downgrade or additional model call was introduced.
- No bridge, response-mode, thread, orientation, evidence, integrity, or fairness
  field was removed.
- Replies are still fully validated and repaired before display; raw tool output is
  not streamed to the applicant.
- Applicant answers remain durably persisted before the model request.
- Queue failure invokes the former inline completion path so reports and webhooks
  are not silently lost.

## Live verification — 21 August 2026

The established artist, curator, enthusiast, and hybrid identity replays were run
against the local `/doorcheck` runtime and hosted Forum Application project after
the changes were deployed.

| Identity | User turns | Harness average | Maximum |
| --- | ---: | ---: | ---: |
| Artist | 6 | 10.5s | 13.0s |
| Curator | 8 | 10.9s | 13.0s |
| Enthusiast | 6 | 10.1s | 12.5s |
| Hybrid | 9 | 10.9s | 13.4s |

These harness averages include the fast session-start request, so they are useful
for comparison with earlier identity replays but understate the wait for an actual
model response. The combined comparison average was approximately 10.6 seconds.
That improves on the older 11.9–12.9-second identity baseline, but does not improve
on the most recent 9.6–10.1-second replay range. The current run therefore does not
establish an active-turn latency gain.

A focused artist replay captured stage timings for eight model-backed messages:

- end-to-end p50: 11.8s;
- end-to-end p95: 12.0s;
- conversation-model p50: 11.2s;
- conversation-model p95: 11.5s;
- warm persona resolution: normally 0ms;
- terminal request: 11.9s, including 158ms terminal persistence and 129ms queue
  enqueueing.

The model call accounts for roughly 95% of the applicant-visible wait. Project and
persona caching reduces small database stages, but does not materially change the
overall experience while model generation remains around 10.7–11.5 seconds.

The completion queue is deployed and working. All five jobs created by these test
runs completed on their first attempt, 0.82–1.07 seconds after enqueueing. This work
now happens after the neutral close is returned, rather than adding that delay to
the terminal request.

The replay runner now records every request duration, the development
`Server-Timing` value, and the terminal-request duration so future comparisons can
separate model time from application overhead.

## Slim conversation contract — 21 August 2026

The live application-turn contract was reduced without changing the conversation
model, applicant-facing API, signal definitions, adaptive routing, or terminal
thresholds.

The model no longer generates these fields on every application turn:

- input type, intent, emotional posture, and visual state; these are derived from
  the validated conversation move, with configured participation options restored
  deterministically when that signal is selected;
- three bridge candidates plus a selected index; the model now returns at most one
  `selectedBridge`, which must be the bridge already used in the visible reply;
- orientation evidence prose; compact orientation scores remain and are merged with
  deterministic explicit-role inference;
- a full terminal reviewer report; the runtime builds the evidence-backed report
  from persisted signal answers and integrity state instead;
- six verbose answer-evidence properties; a compact evidence-flag array is accepted,
  while the parser remains compatible with stored and mocked legacy output.

Decision-critical accumulated scores, answer quality, routing move, response mode,
covered signal keys, orientation scores, cultural signals, thread state, next signal,
and terminal state remain in the model contract. Cultural-signal extraction stays in
the live call for now so the existing privacy-reviewed community-memory feature does
not regress.

Additional reductions:

- model output ceiling reduced from 1,100 to 700 tokens;
- compact state JSON is no longer pretty-printed;
- duplicated technical instructions were removed from the cached system suffix;
- the parser normalises accidentally double-escaped line breaks;
- active-turn validation now repairs replies that contain more than one separately
  phrased question.

The resulting tool definition is approximately 6.4KB with 11 required fields; the
technical system suffix is approximately 1.3KB. Legacy output remains parseable.

### Live comparison

The same artist, curator, enthusiast, and hybrid identities were replayed after the
contract reduction.

| Identity | User turns | Harness average | Maximum | Terminal request |
| --- | ---: | ---: | ---: | ---: |
| Artist | 6 | 7.6s | 10.5s | 9.2s |
| Curator | 7 | 7.4s | 10.4s | 10.4s |
| Enthusiast | 6 | 6.7s | 8.7s | 7.8s |
| Hybrid | 7 | 7.4s | 9.3s | 9.3s |

Across 26 model-backed messages, end-to-end latency was 8.4 seconds p50 and
10.4 seconds p95. Conversation-model latency was 7.7 seconds p50 and 9.4 seconds
p95. The four-identity harness average fell from approximately 10.6 seconds to
7.3 seconds, a reduction of about 31%. The maximum fell from 13.4 to 10.5 seconds.

All four sessions completed, produced evidence-backed reports, and received the
expected `recommend` advisory outcome. The curator, enthusiast, and hybrid routes
finished with the expected orientation; the artist run still exposed the existing
artist-plus-discussion over-promotion to `hybrid`. The replay also showed one
redundant curator role question and one hybrid maker disclosure that was not followed
before the song route. These are conversation-routing improvements, not latency
failures, and remain follow-up work.

## Live-contract phase 2 — 30 August 2026

The live tool contract has been reduced again, from 12 required fields to 9. The
model no longer produces participant orientation, response mode, bridge audit data,
or conversation-thread bookkeeping. Orientation, response mode, and thread state
are now derived from explicit answers, the accepted conversation move, and persisted
state in application code; bridge audit output is omitted from the live path.
Legacy structured responses containing the removed fields remain parseable.

The remaining required model fields are the visible reply, terminal proposal,
accumulated scores, current-answer assessment, answer/question relation,
conversation move, cultural signals, covered evidence keys, and next evidence key.
The maximum live response allowance is now 500 tokens rather than 700.

The terminal presentation pause is no longer the default in `GatekeeperV2`, and the
in-repository doorcheck displays terminal copy immediately. Consumers that prefer a
deliberate decision moment can still opt into it with `decisionMoment` and configure
its two durations.

### Expected effect and verification gate

These changes reduce both the tool definition sent to the model and the structured
output it must generate. They should improve complete-response latency, but no gain
is claimed until the artist, curator, enthusiast, and hybrid replay suite has been
run against the deployed environment. Compare model and total p50/p95 with the
8.4-second total p50 and 7.7-second model p50 recorded above, and retain the change
only if conversation quality and structured-output validity remain acceptable.

### Next phase

Cultural-signal extraction remains in the live call because the completion worker
currently persists signals already attached to message metadata. Move extraction
into the durable terminal completion job before removing `culturalSignals` from the
live contract. This work is implemented in phase 3 below. After that migration,
benchmark a two-phase response in which a small
reply envelope can be streamed while private terminal assessment finishes. Model
selection should use the same fixed replay corpus and compare time to first token,
complete-response p50/p95, valid-output rate, routing accuracy, and terminal accuracy.

## Background cultural-signal extraction — 30 August 2026

Cultural-signal extraction now runs only after a session reaches a terminal state.
The live conversation tool no longer defines or requires `culturalSignals`, reducing
the contract from 9 required fields to 8 and removing this analysis from every
applicant-visible model turn.

For opted-in, non-bot projects, the durable completion worker sends applicant
messages to a dedicated structured extractor. Every returned signal must reference
an exact source message ID supplied in the schema. The existing normalizer still
rejects low-confidence, unsafe, excessively long, or unknown signal values before
the worker writes an event. Legacy signals already stored in message metadata remain
valid and are merged without re-extracting those messages.

Event persistence remains idempotent on source message, signal type, and normalized
key. Profile/verdict work and cultural extraction run concurrently inside the
background job. Extraction failure therefore uses the existing completion-job retry
and backoff behavior without delaying the applicant response.

No schema or Data API exposure change is required. The worker uses the existing
server-only Supabase client and existing cultural-signal tables. The extractor uses
the default low-cost model and can be overridden with
`GROUCHO_CULTURAL_SIGNAL_EXTRACTION_MODEL` for evaluation.

The next latency phase is the two-phase reply/assessment streaming experiment and a
fixed-corpus model benchmark. As before, no active-turn latency improvement is
claimed until deployed replays establish p50/p95 and quality results.

## Phase 3 live baseline — 30 August 2026

The fixed artist, curator, enthusiast, and hybrid replay corpus was run against the
current local Groucho runtime connected to the configured hosted Forum Application
test project. This matches the environment used for the earlier comparisons while
measuring the phase 2 and background cultural-extraction changes together. It is a
live integration baseline, not a public-production deployment measurement.

The run captured 34 model-backed replies. Percentiles below use continuous linear
interpolation over message requests only; session-start requests are excluded.

| Measurement | Samples | Mean | p50 | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| Browser-observed request | 34 | 4.65s | 4.67s | 5.28s | 5.45s |
| Server total | 34 | 4.61s | 4.62s | 5.25s | 5.43s |
| Conversation model | 34 | 4.16s | 4.20s | 4.83s | 4.87s |

Compared with the preceding slim-contract baseline:

- server-total p50 fell from 8.4s to 4.62s, a 45% reduction;
- server-total p95 fell from 10.4s to 5.25s, a 50% reduction;
- conversation-model p50 fell from 7.7s to 4.20s, a 45% reduction;
- conversation-model p95 fell from 9.4s to 4.83s, a 49% reduction;
- the four-identity harness average fell from 7.3s to approximately 4.2s;
- the maximum observed reply fell from 10.5s to 5.45s.

All four sessions passed and produced a `recommend` advisory outcome. Every model
reply was accepted as usable or rich, with no false close, repeated-question flag,
safety flag, or insufficient-evidence signal. Curator, enthusiast, and hybrid
orientation matched their fixtures. The artist fixture again resolved to hybrid,
preserving the previously documented artist-plus-discussion over-promotion rather
than introducing a new regression. One hybrid reply needed the existing receipt
repair. The enthusiast fixture took 11 turns because several supplied answers were
deliberately repeated; this increased the sample count without producing a false
close.

All four durable completion jobs completed on their first attempt with no recorded
error, confirming that profile, verdict, and cultural-signal work remained outside
the applicant-visible request path.

The conversation model still accounts for about 90% of server time. That makes the
next useful experiment perceived-latency work: measure time to first safe visible
text for a two-phase or streaming response while retaining complete-response p50/p95
and the same routing and terminal-quality gates. The current 4.67s browser p50 and
5.28s browser p95 are the pre-streaming control values.
