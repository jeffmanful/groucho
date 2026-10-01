# Recommended role for Jev in Groucho

Date: 25 September 2026

Status: initial recommendation, updated after the 50-case paired evaluation; not approved for production routing

Update: the [critical review and paired evaluation](./jev-narrow-evaluation-2026-09-25.md) revisits these recommendations. The early terminal helper did not reproduce the production controller, and multi-goal coverage already exists in Groucho. Treat benefits below as hypotheses requiring an incremental comparison.

## Recommendation

Use Jev only as a **narrow semantic sidecar** that returns atomic facts. Do not use it as an applicant judge, an access-decision model, the owner of conversation policy, or the writer of Groucho's replies.

The useful contract is:

1. **Answer relation:** is the reply direct, partial, ambiguous, or a subject shift?
2. **Conservative evidence coverage:** which predefined evidence goals are explicitly supported by this answer?
3. **Explicit boundary signals:** does the answer literally disclose fabrication, primarily extractive intent, or an unambiguous consent violation?

Deterministic Groucho code should combine those facts with session state and policy. Claude should continue to write the natural-language response when one is needed.

```text
Applicant answer
      |
      +--> Jev: atomic semantic facts --------+
      |                                       |
      +--> Groucho state and policy ----------+--> deterministic route
                                                      |
                                      +---------------+---------------+
                                      |                               |
                                reply needed                    safe terminal state
                                      |                               |
                              Claude writes reply             deterministic close
```

Jev should not return or control:

- an accept, decline, or suitability recommendation;
- participant identity or orientation;
- a broad quality judgment;
- the final `next_action` or `next_signal`;
- applicant-facing prose.

Those broader outputs were either outside the intended role or did not meet the frozen evaluation gates.

## Why this role fits Jev

Jev was strongest when the question had a bounded answer space and literal criteria. Its narrow outputs are also inspectable: Groucho can log a probability, apply a conservative threshold, and independently decide what that fact is allowed to change.

This division preserves clear ownership:

| Responsibility | Owner |
|---|---|
| Detect a narrowly defined semantic property | Jev |
| Track covered and missing goals | Groucho state |
| Apply thresholds, policy, fallbacks, and closing rules | Deterministic code |
| Write a natural, context-aware response | Claude |
| Grant, deny, or escalate access | Existing Groucho/client policy |

## Observed evidence

Two synthetic evaluations were run through OpenRouter using `typesafe/jev-1.13`, resolved to `typesafe/jev-1.13-20260917`. Neither run touched production data or behavior.

### Turn-routing experiment: 13 turns

| Measurement | Result | Interpretation |
|---|---:|---|
| Narrow-risk agreement | 13/13 | Strongest observed capability |
| Relation agreement | 12/13 (92.3%) | Promising, but the sample is small |
| Evidence coverage precision | 10/12 (83.3%) | Too many false positives for question-skipping |
| Evidence coverage recall | 10/11 (90.9%) | Promising opportunity detection |
| Multi-goal exact match | 1/2 | Main fewer-questions hypothesis not yet established |
| Broad quality agreement | 9/13 (69.2%) | Do not use |
| Proposed action agreement | 10/13 (76.9%) | Do not delegate routing |
| Proposed next-goal agreement | 8/13 (61.5%) | Do not use |
| Safe terminal rule | 1/1 detected; 0 false positives | Promising, but only one positive case |
| Warm latency | 489 ms mean; 654 ms p95 | Material overhead if run sequentially |
| All-request latency | 479 ms p50; 1,633 ms p95 | Included a 3,090 ms first-call outlier |
| Cost | $0.000922824 total | About $0.000071 per evaluated turn |

At the observed per-turn price, 1,000 similarly sized turns would cost roughly **$0.071**, and 10,000 would cost roughly **$0.71**. These are simple extrapolations from the test, not a quote or production forecast. A narrower request should use fewer tokens, but that saving has not been measured.

### Earlier holistic experiment: 9 cases

| Measurement | Result | Interpretation |
|---|---:|---|
| Risk agreement | 9/9 | Again supported narrow literal predicates |
| Recommendation agreement | 6/9 (66.7%) | Not suitable as a judge |
| Orientation agreement | 7/9 (77.8%) | Not reliable enough for identity classification |
| Latency | 574 ms p50; 1,212 ms p95 | Similar warm-path order of magnitude |
| Cost | $0.000478506 total | API cost remained negligible in the test |

Do not pool these runs into a 22/22 narrow-risk accuracy estimate: the earlier risk label included insufficient evidence and both runs collapsed predicates into a priority label. Their samples also share related scenarios. Evidence precision was 10/12 in the second run; these author-labelled synthetic examples are too small and correlated to establish production reliability. More independently reviewed examples are required.

Full experiment records:

- [Jev turn-routing speed experiment](./jev-turn-routing-experiment-2026-09-25.md)
- [Jev holistic shadow experiment](./jev-shadow-experiment-2026-09-25.md)

## Potential benefits

### 1. Fewer redundant questions

An answer can cover more than the goal Groucho explicitly asked about. Reliable per-goal detection would let the controller mark several goals complete and avoid asking for the same evidence later.

This is potentially the largest product benefit because it saves an entire model round trip **and** an applicant interaction. The current test did not establish it: only one of two multi-goal examples was exact, and coverage precision was below the safety gate.

### 2. Smaller Claude contract

If Jev supplies reliable atomic facts, Claude can focus on composing the response rather than simultaneously classifying the answer, updating structured state, choosing a route, and writing prose. A smaller contract may improve Claude latency, consistency, and prompt maintainability.

That benefit remains a hypothesis until the current combined Claude call is benchmarked against a Jev-plus-reply-only Claude call.

### 3. A terminal no-Claude path

The proposed terminal shortcut would close without another Claude reply once the full Groucho terminal policy permits it. The experiment's simplified helper found its one eligible example and rejected both blocked examples, but did not exercise that full policy.

The saving could be meaningful because it removes a complete final model call, but three terminal examples are not enough to authorize production behavior.

### 4. More inspectable behavior

Atomic probabilities and explicit thresholds are easier to test than a broad free-form judgment. Failures can be attributed to one predicate, thresholds can be versioned, and deterministic policy remains reviewable.

### 5. Low marginal API spend

The measured API charge was tiny. Cost is therefore unlikely to be the deciding constraint at early Groucho volumes. Latency, reliability, privacy, and maintenance are more important.

## Opportunity cost

### Latency tax

A sequential Jev request added about **0.49 seconds on average excluding the first request**, with a **0.65-second p95** on that subset. The first request reached **3.09 seconds**; its cause was not established.

The simple break-even condition is:

```text
Claude time removed + value of questions avoided > Jev latency + integration overhead
```

If Jev runs before Claude and does not materially shrink the Claude call, the flow becomes slower. Using the existing documented browser control of 4.67-second p50 only as context, naively adding the observed Jev p50 would move a turn toward roughly 5.15 seconds before allowing for any Claude saving. These measurements come from different harnesses, so that sum is illustrative rather than a benchmark result.

Parallel execution can hide some latency, but it limits how much Jev can alter the same reply: Claude cannot depend on a result that has not arrived. Parallel Jev is most useful for updating the next state or validating a proposed transition, not for selecting the prompt already in flight.

### Reliability cost

A false coverage positive can cause Groucho to skip a useful question. The experiment produced two such errors at the frozen threshold. This is more damaging than a false negative, which usually costs only an unnecessary question.

For that reason, coverage must be asymmetric and conservative:

- use high-confidence positives only;
- never infer coverage from thematic similarity;
- treat uncertainty as “not yet covered”;
- require deterministic closing conditions;
- keep a fallback to the current flow.

### Engineering and maintenance cost

Production use adds another external service, schema, timeout, retry policy, model version, telemetry path, and failure mode. The team would need to maintain:

- version-pinned request contracts and threshold configuration;
- replay and holdout datasets;
- monitoring for latency, malformed responses, and semantic drift;
- fallbacks when OpenRouter or TypeSafe is unavailable;
- privacy, retention, and data-processing approval before real applicant text is sent;
- regression evaluation whenever questions, evidence goals, or the model snapshot change.

As a planning estimate rather than measured effort, a new holdout evaluation is likely a small task; a robust shadow integration and telemetry layer is several engineering days; privacy approval and production hardening are schedule-dependent. That time competes directly with simpler performance work.

### Alternative-use cost

Before adding Jev to the critical path, the same engineering time could be spent on options with no new inference round trip:

- reducing the existing Claude prompt and structured response;
- moving obvious state transitions into deterministic code;
- removing duplicated evidence from model context;
- streaming the conversational response earlier;
- measuring where the present 4–5 second turn time is actually spent;
- improving goal tracking so already-covered facts are reused without another classifier.

Those alternatives may deliver less semantic flexibility, but they carry lower operational and privacy complexity. Jev should beat the best of these options in an end-to-end comparison, not merely perform its own classification quickly.

### Product-complexity cost

Two models can disagree. Without strict ownership, the system becomes harder to explain: Jev may identify one route while Claude's prose implies another. Keeping Jev atomic and deterministic policy authoritative reduces this risk, but does not remove the need for traceability and debugging tools.

## Basic evaluation plan before implementation

### Gate 1: narrow held-out semantic suite

Create a new frozen set of at least 50 turns, with enough positive and negative examples for every predicate. Include paraphrases, negative framing, multi-goal answers, thematic near-misses, adversarial instructions, and all terminal blockers.

Pre-register the threshold and require:

- evidence precision at least 95%;
- evidence recall at least 90%;
- relation agreement at least 90%;
- every explicit boundary case detected with no false positives in the set;
- every safe terminal case detected with zero unsafe closes;
- warm p95 below 750 ms and malformed-response rate below 1%.

Report counts and confidence intervals, not only percentages. Fifty cases are still a development signal, not a production guarantee.

### Gate 2: shadow replay

Run the narrow Jev contract without changing behavior. Compare its facts with the current Groucho state transitions and record:

- would-have-skipped questions;
- false coverage positives and negatives;
- terminal opportunities and blockers;
- latency, timeouts, and cost;
- model/version drift.

Real applicant text should not be used until data processing and retention are approved. Redacted or consented replay data is preferable for the first shadow.

### Gate 3: end-to-end speed comparison

Compare three variants on the same replay set:

1. current combined Claude call;
2. narrow Jev followed by reply-only Claude;
3. narrow Jev in parallel where its result affects only subsequent state.

Measure full-turn p50/p95, time to completed flow, number of applicant turns, reply quality, error rate, terminal-call avoidance, and total cost. Jev earns a production role only if the complete flow becomes faster without weaker safety or conversation quality.

## Implementation decision

The additional 50-case paired experiment is now complete; see the linked critical review for its frozen design and results. The old Jev coverage questions at a stricter threshold performed better than the narrower rewrite, while classifier latency was effectively unchanged. This supports conservative coverage calibration for shadow testing, not a new sequential production stage.

The review also found an existing contribution filter rejecting valid phrasings. Improving that guard is the strongest immediate candidate for both accuracy and avoiding unnecessary questions without adding an API round trip. Any Jev integration still needs a comparison against the current Claude flow and the real terminal policy.
