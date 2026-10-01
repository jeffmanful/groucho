# Jev turn-routing speed experiment

Date: 25 September 2026

Status: completed; promising narrow predicates, but the full routing hypothesis did not pass

## Decision being tested

This experiment does **not** ask Jev to judge an applicant, recommend an access decision, or write the conversation. It tests whether Jev can cheaply identify a small set of semantic facts that could make the Groucho flow faster:

- whether an answer is direct, partial, a subject shift, or ambiguous;
- whether the answer is thin, usable, rich, or explicitly concerning;
- which evidence goals the answer covers, including more than one goal at once;
- the smallest plausible next conversational action and evidence goal;
- three narrow, explicit integrity predicates already defined by Groucho.

Groucho's deterministic controller remains responsible for state, policy, routing, and the terminal fast path. Claude remains responsible for the natural-language reply when a reply is needed.

## Hypothesis

Jev may improve flow speed in two ways that match its strengths:

1. **Fewer conversational turns.** If one answer covers several evidence goals, Groucho can avoid asking a redundant question.
2. **Less work for the conversational model.** A compact Jev readout can replace part of the structured analysis currently bundled into the reply-generation call. When the final required goal is covered safely, deterministic code may close without another model call.

This first test establishes classification feasibility and Jev latency. It does not yet measure end-to-end Groucho latency or prove that a Jev-plus-Claude sequence is faster than the current combined Claude call.

## Safe test design

The harness runs 13 frozen, synthetic turns. They cover direct, partial, ambiguous, subject-shift, thin, rich, multi-goal, and explicit-boundary cases. Three cases exercise terminal-close behavior: one valid fast close and two cases that must be blocked.

Safety boundaries:

- no real applicant content;
- no database reads or writes;
- no application sessions or access decisions;
- no runtime or applicant-facing integration;
- one batched Jev request per synthetic turn;
- reports contain case IDs and readouts, not the synthetic turn text;
- malformed responses fail closed;
- labels and gates are frozen before the first live run.

The live requests use OpenRouter's Decisions endpoint with `typesafe/jev-1.13`. The API key is read from `.env.local` and is neither printed nor stored in the report.

## Frozen success gates

The experiment is promising enough for an end-to-end shadow A/B only if all of these hold on the frozen set:

| Measure | Gate | Why it matters |
|---|---:|---|
| Evidence-goal precision | at least 95% | Avoid skipping a needed question because Jev claimed unsupported coverage. |
| Evidence-goal recall | at least 90% | Capture opportunities to remove redundant questions. |
| Multi-goal exact matches | 2 of 2 | This is the main route to fewer turns. |
| Relation agreement | at least 12 of 13 | Repairs must be dependable. |
| Quality agreement | at least 11 of 13 | Thin answers must not unlock progress or closing. |
| Action agreement | at least 11 of 13 | Useful as an advisory next-action signal, not policy. |
| Next-goal agreement | at least 11 of 13 | Prevent unnecessary detours in the flow. |
| Narrow-risk agreement | 13 of 13 | The speed path must not bypass explicit boundary handling. |
| Terminal fast path | detect 1 of 1, with zero false positives | The highest-value latency saving must fail safely. |
| Errors or malformed responses | zero | The baseline must complete cleanly. |
| Jev warm-request p95 | below 750 ms | Leaves a plausible latency budget for an end-to-end design. |

The first request is reported separately as a possible cold-start observation. With only 13 cases, these gates are directional rather than production-quality evidence.

## Implementation under test

- [`evals/jev-turn-routing-cases.ts`](../evals/jev-turn-routing-cases.ts) contains the frozen synthetic turns and expected semantic labels.
- [`lib/jev-turn-routing-evaluation.ts`](../lib/jev-turn-routing-evaluation.ts) builds atomic Jev questions and derives the safe terminal condition in deterministic code.
- [`scripts/run-jev-turn-routing-experiment.ts`](../scripts/run-jev-turn-routing-experiment.ts) runs the redacted benchmark and calculates agreement, coverage, cost, and latency.
- [`lib/__tests__/jev-turn-routing-evaluation.test.ts`](../lib/__tests__/jev-turn-routing-evaluation.test.ts) verifies batching, multi-goal coverage, deterministic closing, risk blocking, and fail-closed behavior.

Run a no-network safety check with:

```sh
pnpm experiment:jev-turn-routing:dry
```

Run the live synthetic benchmark with:

```sh
pnpm experiment:jev-turn-routing
```

## Pre-run verification

- Dry run: passed; 13 synthetic turns, zero external requests, zero writes, no turn text in output.
- Focused tests: passed; 13 of 13 tests across the shared Jev transport and turn-routing harness.
- Lint: passed for all Jev experiment files.
- Type check: passed.

## Live result

The frozen run completed successfully through OpenRouter and resolved to `typesafe/jev-1.13-20260917` on TypeSafe's provider. All 13 requests returned valid responses. Total reported cost was **$0.000922824**.

| Measure | Result | Gate | Outcome |
|---|---:|---:|---|
| Evidence-goal precision | 83.33% (10 TP, 2 FP) | at least 95% | **Fail** |
| Evidence-goal recall | 90.91% (1 FN) | at least 90% | Pass |
| Evidence-goal F1 | 86.96% | reported only | — |
| Multi-goal exact matches | 1 of 2 | 2 of 2 | **Fail** |
| Relation agreement | 12 of 13 (92.31%) | at least 12 of 13 | Pass |
| Quality agreement | 9 of 13 (69.23%) | at least 11 of 13 | **Fail** |
| Action agreement | 10 of 13 (76.92%) | at least 11 of 13 | **Fail** |
| Next-goal agreement | 8 of 13 (61.54%) | at least 11 of 13 | **Fail** |
| Narrow-risk agreement | 13 of 13 | 13 of 13 | Pass |
| Terminal fast path | 1 of 1; 0 false positives | 1 of 1; 0 false positives | Pass |
| Errors or malformed responses | 0 | 0 | Pass |
| Warm-request p95 | 653.8 ms | below 750 ms | Pass |

All-request latency was 689.1 ms mean, 479.1 ms p50, 1,632.6 ms p95, and 3,090.2 ms maximum. The first request was the 3,090.2 ms outlier. Excluding that possible cold start, the remaining 12 calls averaged 489.0 ms, with a 653.8 ms p95 and 660.9 ms maximum.

### What worked

- Jev correctly detected all explicit fabrication, extractive-intent, and consent predicates.
- The deterministic terminal rule correctly allowed the one safe close and blocked both unsafe closes. This matters more than Jev's own `next_action`: Jev labelled the valid terminal case `advance`, but the controller still derived the correct close from the reliable atomic facts.
- Relation classification met the small-set gate.
- Warm latency and cost are plausible for a focused sidecar, although they do not yet prove an end-to-end speed improvement.

### What did not work

- At the frozen 0.5 coverage threshold, Jev produced two false coverage positives. It treated thematic proximity as evidence in one cultural-goal case and treated an explicit consent violation as contribution evidence in another. Either could make Groucho skip a useful question.
- Jev missed one negatively framed COLORS-relationship signal, producing the single false negative.
- `quality`, `next_action`, and especially `next_signal` were not stable enough to own routing. Several differences were arguably taxonomic rather than dangerous, but the frozen labels correctly expose that these broad choices are not Jev's strongest role.
- Only one of the two multi-goal cases was exact, so the main fewer-turns hypothesis did not pass as configured.

### Post-run sensitivity observation

Both false coverage positives scored below 0.75 (0.57 and 0.60), while all ten true positives in this run scored at least 0.70. A 0.75 threshold would remove both false positives but would also turn the 0.70 fabrication-case coverage into another false negative. More importantly, changing a threshold after inspecting the same cases is not a valid pass. It is only a useful hypothesis for a new frozen holdout set.

## Conclusion

Do not use this full Jev readout as Groucho's router. The experiment supports a smaller role aligned with Jev's strengths:

- atomic relation checks;
- conservative per-goal coverage hints;
- narrow explicit-risk predicates;
- deterministic code combining those facts into policy and fast-close decisions.

Drop Jev's broad `quality`, `next_action`, and `next_signal` outputs from the proposed speed path. They add tokens and conceptual overlap without meeting the reliability gates. A reply model or deterministic controller can choose the next conversational move from the narrower facts.

## Next decision

The next experiment should first validate the narrower contract on a new frozen holdout set, using a conservative coverage threshold selected before the run. Only if coverage precision and multi-goal detection pass should Groucho compare the current combined Claude turn with a shadow architecture that runs narrow Jev classification and a reply-only Claude prompt.

That end-to-end comparison should measure full turn latency, time to completed application, number of questions avoided, output quality, error rate, and cost on the same replay set. It should test both sequential and parallel execution: a sequential Jev round trip adds roughly 0.5–0.65 seconds when warm, so it helps only if it removes more downstream work than it adds. No production routing should change until that comparison shows a real speed benefit without weaker safety or conversation quality.
