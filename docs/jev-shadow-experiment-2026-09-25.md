# Jev shadow experiment — 25 September 2026

## Status

The safe evaluation harness is implemented and verified locally. It supports direct
TypeSafe access and OpenRouter's Decisions API. When `OPENROUTER_API_KEY` is present,
OpenRouter is preferred; otherwise the harness falls back to `TYPESAFE_API_KEY`.
No production runtime, database, applicant conversation, or decision policy was
changed. The first live OpenRouter run is complete: the safety/risk evaluation
passed, but recommendation, orientation, and full-run latency gates failed. Jev is
not approved for production integration from this result.

## Question

Can Jev reliably and quickly perform Groucho's bounded private judgments so the
generative conversation model can eventually return a much smaller, reply-focused
response?

This experiment does not test replacing Groucho's voice, generating reviewer prose,
or allowing Jev to grant or deny access.

## Safety boundary

- Nine synthetic, client-labelled cases only: five confirmed positive anchors plus
  persistent vagueness, admitted fabrication, repeated extractive intent, and the
  confirmed artist-consent violation.
- No real applicant data or Supabase access.
- No database writes, webhooks, application decisions, or applicant-facing changes.
- The report contains case IDs and numeric/closed-set results, not evidence text.
- `jev-1.13.0` for direct access or `typesafe/jev-1.13` through OpenRouter is pinned
  so an alias update cannot silently change the evaluated model.
- Missing credentials, malformed responses, and timeouts fail closed.
- The shadow rule can emit only an experimental recommendation. It is not connected
  to Groucho's authoritative client-owned decision policy.

## Batched questions

Every case is one request containing nine independent questions:

1. specificity score;
2. reciprocity score;
3. cultural-depth score;
4. contribution score;
5. evidence sufficiency choice;
6. participant orientation choice;
7. explicit admitted-fabrication probability;
8. repeated extractive-intent probability;
9. confirmed consent-violation probability.

The request deliberately contains no direct “accept or decline this applicant”
question. A small, inspectable shadow-only rule combines the atomic answers. Only the
confirmed consent boundary can produce `decline`; fabrication, extractive intent,
insufficient evidence, uncertainty, and ordinary low scores route to `human_review`.

## Commands

Inspect the request shape without an external call:

```bash
pnpm experiment:jev-shadow:dry
```

Run the live synthetic evaluation after adding `OPENROUTER_API_KEY` or
`TYPESAFE_API_KEY` to `.env.local`:

```bash
pnpm experiment:jev-shadow
```

The live command prints a redacted JSON report to standard output. Redirect it to an
ignored or otherwise approved location if a durable experiment artifact is needed.

## Verification completed

- The dry run confirms nine synthetic cases, nine atomic questions per case, zero
  external calls, zero database writes, and no evidence text in the report.
- Eight focused unit tests verify request construction, positive recommendation behavior,
  human-review routing, the narrow decline boundary, endpoint invocation, and
  fail-closed handling, including the OpenRouter endpoint and pinned model.
- TypeScript and focused lint checks pass.

## Live acceptance gate

Do not integrate Jev into the conversation path unless a live run establishes all
of the following:

- 9/9 expected recommendation bands;
- 9/9 expected participant orientations, or a documented client-approved exception;
- all four boundary signals detected at the intended threshold without false
  positives on the five positive anchors;
- Jev p95 below 750 ms for this corpus;
- no request errors or malformed answers;
- a separate adversarial suite shows that applicant-authored instructions cannot
  cross the automatic-action boundary;
- TypeSafe retention and processing terms are approved for the intended data.

Even if these gates pass, the first runtime integration must remain shadow-only. The
next benchmark would compare the current combined Claude contract against Jev
classification followed by a reduced reply-only Claude contract, using the existing
4.67-second browser p50 and 5.28-second p95 as the control.

## Result log

### 25 September 2026 — OpenRouter live shadow run

The harness sent the nine synthetic cases through OpenRouter's Decisions API using
the pinned `typesafe/jev-1.13` model. OpenRouter reported the resolved snapshot as
`typesafe/jev-1.13-20260917` and the routed provider as TypeSafe for every case.

Safety controls held:

- production impact: none;
- real applicant data sent externally: none;
- database writes, webhooks, and access decisions: zero;
- report evidence text: none;
- verification before the run: 8 focused tests, TypeScript, focused lint, and the
  dry run all passed.

#### Aggregate result

| Measurement | Result | Acceptance gate | Outcome |
| --- | ---: | ---: | --- |
| Recommendation agreement | 6/9 (66.7%) | 9/9 | Fail |
| Orientation agreement | 7/9 (77.8%) | 9/9 or approved exception | Fail |
| Risk agreement | 9/9 (100%) | All boundaries, no positive false alarms | Pass |
| Mean latency | 682.1 ms | Informational | — |
| p50 latency | 573.7 ms | Informational | — |
| p95 latency | 1,211.5 ms | Below 750 ms | Fail |
| Maximum latency | 1,559.4 ms | Informational | — |
| Total cost | $0.000478506 | Informational | — |

The first request was the 1,559.4 ms maximum. The remaining eight requests ranged
from 428.8 ms to 689.7 ms; their warm-path p95 was approximately 687.9 ms. The full
nine-case p95 remains the acceptance measurement and therefore fails the stated
gate. This distinction should be measured deliberately in a repeated cold/warm
benchmark rather than removing the first observation after the fact.

#### Case-level result

| Case | Expected recommendation | Observed | Expected orientation | Observed | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| Active contributor artist | recommend | human_review | artist | hybrid | correct: none |
| Thoughtful listener | recommend | human_review | enthusiast | curator | correct: none |
| Constructive specialist curator | recommend | recommend | curator | curator | correct: none |
| Community-minded emerging artist | recommend | recommend | hybrid | hybrid | correct: none |
| Early-stage intentional artist | recommend | human_review | artist | artist | correct: none |
| Persistently vague | human_review | human_review | enthusiast | enthusiast | correct: insufficient evidence |
| Admitted fabrication | human_review | human_review | enthusiast | enthusiast | correct: fabrication |
| Repeated extractive intent | human_review | human_review | curator | curator | correct: extractive intent |
| Artist-consent violation | decline | decline | curator | curator | correct: consent violation |

#### Interpretation

Jev was strongest on the narrow, literal safety questions. It detected all four
boundary conditions at the intended threshold and produced no risk false positives
on the five positive anchors. This supports further investigation as an integrity
sidecar, still without authority to create a decision.

The broad suitability and orientation questions are not calibrated well enough for
Groucho. Three client-confirmed positive anchors were routed to review. Two familiar
identity errors also appeared: reciprocal artistic practice promoted an artist to
hybrid, while a listener who shares considered discoveries was promoted to curator.
The conservative uncertainty behavior is safer than false acceptance, but it does
not satisfy the confirmed client labels.

#### Decision

Do not integrate this question set or shadow rule into Groucho's production path.
Retain the harness for controlled iteration. The next experiment should keep this
run frozen as the baseline, refine orientation criteria using new development cases
rather than these nine evaluation cases, add paraphrased and adversarial examples,
and rerun a held-out evaluation. A separate repeated latency run should report cold
and warm distributions explicitly.
