# Groucho conversation request experiment

## Frozen design

Compare actual `postSessionMessage` execution using synthetic project settings and a fixed synthetic COLORS persona. External storage, media fetch, automatic actions, and completion jobs are replaced by in-memory substitutes. The real prompt builders, compact state, parser, coverage filters, conversation controller, repair logic, and closing logic execute unchanged. No production changes or database writes.

This is a runtime replay at fixed turn snapshots. It is not a deployed-project benchmark: the hosted persona is not loaded, network/database latency is excluded, and model replies do not determine subsequent fixture inputs. It cannot establish application completion-time improvements or questions saved. The short persona is identical across variants.

Twelve fixtures, two repetitions, three arms = 72 Anthropic calls. Order rotates by fixture and repetition. Use the configured conversation model (default `claude-haiku-4-5-20251001`), production 500-token limit, forced tool use, and ephemeral system cache. SDK retries disabled; first network failure aborts. Report cache reads/writes and all-request latency; do not discard a slow first call.

- Control: unmodified production model request.
- Short instructions: replace only the lengthy instructions preceding the compact JSON state with a concise specification. Preserve JSON state, system/persona/application instructions, and every tool field.
- Short contract: use the short instructions and omit the two private reason strings (`answerAssessment.reason`, `answerRelation.reason`). Retain scores, evidence flags, relation, move, coverage, reply, terminal and next goal. Existing parser accepts absent reasons as empty strings; these explanations are useful for audit, so removing them has a tradeoff even if routing survives.

Fixtures cover opening community intent, COLORS specificity, artist context, multiple goals, vagueness, a subject shift, explicit consent violation, brief unpolished wording, a long current answer, and three memory probes. Memory probes put the same correction inside a short answer, after more than 600 characters, or in a subsequent tagged follow-up. Request inspection records whether the correction reaches the model. Reply mention checks are descriptive, not a complete semantic judge.

Coverage labels are author-defined evaluation targets; overlapping goals may admit other reasonable interpretations. Evaluate raw and persisted coverage separately in the saved report. A model-authored coverage claim is not necessarily what the runtime persists. These fixtures expect active conversation; this is a premature-closing check, not proof of correct terminal behavior on complete applications. No safe-close positive case is included.

Acceptance for a candidate: at least 15% lower median model latency, p95 no worse than control, zero network/schema/token-truncation failures, no additional premature closes, no increase in false coverage or missed coverage, and no lower relation agreement. Inspect the actual applicant replies for coherence, invented facts, and unnecessary questions. A small repeated sample supports a follow-up benchmark, not deployment. Review is by the same assistant, not an independent blinded human panel.

Baseline snapshots and instructions are frozen before live calls. The report records fixture and exact request hashes. The test is dry by default; live use requires `GROUCHO_LIVE_REPLAY=1` and `ANTHROPIC_API_KEY`.

Frozen fixture/instruction SHA-256: `5b9dc077402a9151f5b2b922a8173353aded0dbe3f7cb3ddf9b005a20f19b9e5`.

Before live execution, the 72-call dry replay, TypeScript, lint and whitespace checks passed. Representative request lengths were 51,961 characters for control, 37,034 for short instructions, and 36,810 for the short contract. Character count includes schemas and JSON serialization; it is not a token estimate or a latency result.

## Memory diagnostic before live execution

The production compact-state builder preserves `Sunday access-notes digest` in the short history fixture. It drops the phrase in both the long-answer and subsequent-follow-up fixtures. The underlying tagged messages retain the correction in the in-memory store; it is the model request that loses it. Every variant receives the same compact state, so prompt changes alone cannot recover this missing information. This diagnostic is independent of Claude's response quality.

```sh
node --env-file=.env.local node_modules/vitest/vitest.mjs run evals/conversation-replay.test.ts
GROUCHO_LIVE_REPLAY=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run evals/conversation-replay.test.ts
```

## Interrupted first attempt and reporting amendment

The first live run completed repetition one and reached repetition two's fifth case before an unavailable response (`HTTP 503` from the handler) stopped execution after about 252 seconds. The provider error details were not captured. Under the original abort policy, the aggregate report was never emitted, so those observations cannot be recovered or fairly scored. This attempt is disclosed and excluded from the restarted comparison; its failure is not treated as a successful run.

Before restarting, the harness was amended to emit each observation immediately, capture provider error class/status, and continue through the predeclared 72 slots while recording failures. There are still no automatic retries. Failed calls count against the zero-error gate and are excluded only from successful-response latency distributions, with failure duration recorded separately. Fixture text, model parameters, prompts, labels and success gates are unchanged. The report below describes the separate restarted run.

## Results

The restarted September 25 run attempted all 72 slots: 16 successful model responses and 56 failures. The run did not meet the zero-error gate and cannot support a speed or quality winner. These counts were retained in the tool output; the interruption occurred before its complete raw report was saved to disk. Do not confuse the later six-call diagnostic artifact with that benchmark.

Successful-response medians in the interrupted work were 7,344 ms for control (5 successes), 6,136 ms for short instructions (5 successes), and 5,695 ms for short contract (6 successes). The samples were small, incomplete and uneven, with large timing swings; these numbers are not a valid comparative speed result. No successful memory-probe responses were captured in this run. The separately verified request-level memory omission remains reproducible.

### Failed-request diagnosis — September 27

Six fresh diagnostic requests used the same real handler, first two frozen fixtures, model and three variants. All six succeeded, with model times from 2,903 to 5,278 ms. Fixture/instruction digest remained unchanged. The [complete diagnostic report](./conversation-request-diagnostic-2026-09-27.json) is saved. This establishes that the harness/request variants can currently execute; it does not recover the missing historical error cause or substitute for the full benchmark.

The earlier `503` values were generated by Groucho's own `llm_unavailable` catch block, not recorded Anthropic HTTP statuses. The SDK wrapper recorded `name: Error, status: null` for the 56 failures and omitted the error message, constructor class, cause and request ID. That observability defect prevented a precise retrospective diagnosis.

Offline probes against the installed SDK, with no network calls, established:

| Simulated cause | Recorded `name` | Actual error class | HTTP status |
|---|---|---|---|
| Connection timeout | Error | APIConnectionTimeoutError | absent |
| Provider rate limit | Error | RateLimitError | 429 |
| Invalid credentials | Error | AuthenticationError | 401 |
| Malformed JSON response | SyntaxError | SyntaxError | absent |

Thus, the original name alone cannot identify the SDK error type. The absence of an upstream status is consistent with connection/transport failure and does not support claiming a provider 503 outage, conventional HTTP 429 rate limit, or HTTP 401 authentication failure. Transport disruption/timeouts are the leading hypothesis given the timing swings and later recovery, but the exact original cause is not recoverable from the retained fields. Other status-less local or response-reading errors remain possible.

The diagnostic-only harness now records redacted error message, constructor class, cause message/code, stack and request ID, and supports a six-call diagnostic mode. No runtime fix, retry change, provider change, or application behavior change was applied. The six-call run passed; the default no-network harness, TypeScript and lint were checked afterward.

Recommended next step: use this improved capture on a small representative diagnostic batch if the failure recurs, stop after repeated transport failures, and inspect the actual cause before retrying a full benchmark. Do not promote either prompt variant from the incomplete timing data. A standalone minimal Claude request also succeeded after the September 25 failure run, consistent with recovery but not proof of its cause.
