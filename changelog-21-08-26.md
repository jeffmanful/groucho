# Changelog — 21 August 2026

## Response-time improvements

- Added privacy-safe request-stage timing logs and development `Server-Timing`
  headers for the gatekeeper path.
- Moved terminal profile extraction, verdict creation, webhook preparation, and
  cultural-signal persistence behind a durable Supabase completion-job queue.
- Added atomic `SKIP LOCKED` job claims, retry backoff, abandoned-worker recovery,
  an immediate post-response drain, and authenticated cron drains.
- Retained inline terminal completion as a failure fallback when the durable queue
  cannot be reached.
- Added explicit Anthropic caching to the stable system-prompt prefix without
  changing the model or conversation contract.
- Added 60-second project-settings and persona caches with explicit invalidation on
  admin edits.
- Updated the OpenAPI and SDK documentation to reflect asynchronous terminal profile
  availability.
- Added regressions for timing output, durable job enqueueing and hydration, neutral
  terminal response behaviour, and prompt system-block compatibility.

## Verification

- 44 test files and 313 tests pass, including conversation-contract, timing, and
  completion-job regressions.
- The SDK suite passes independently with 4 test files and 30 tests.
- Strict TypeScript validation, focused changed-file lint, repository whitespace
  checks, and the production Next.js build pass.
- The Supabase CLI is version 2.109.1. No local database was running and the
  repository is not linked through the CLI, but subsequent live verification
  confirmed the completion-job table is available in the configured hosted test
  project.

## Live response-time verification

- Re-ran the established artist, curator, enthusiast, and hybrid journeys against
  the local runtime and hosted Forum Application project.
- Recorded harness averages of 10.1–10.9 seconds and a 13.4-second maximum. This is
  better than the older 11.9–12.9-second baseline, but does not beat the most recent
  9.6–10.1-second replay range.
- Captured a focused eight-message artist sample with an 11.8-second end-to-end p50
  and 12.0-second p95. Conversation-model time was 11.2 seconds p50 and 11.5 seconds
  p95, accounting for roughly 95% of applicant-visible latency.
- Confirmed all five completion jobs completed on their first attempt between 0.82
  and 1.07 seconds after enqueueing, outside the terminal response path.
- Extended the identity replay output with per-request durations, `Server-Timing`
  values, and an explicit terminal-request duration for repeatable comparisons.

## Slim application-turn model contract

- Removed model-generated UI posture fields from the application critical path and
  now derive them from the validated conversation move.
- Replaced three generated bridge candidates and a selected index with one optional
  selected bridge while retaining backwards-compatible parsing.
- Replaced verbose answer-evidence booleans with compact evidence flags and removed
  generated orientation-evidence prose.
- Removed the full reviewer report from model output; the existing evidence-backed
  runtime report remains available to the asynchronous completion path.
- Kept accumulated decision scores, answer quality, routing state, orientation
  scores, cultural signals, covered intents, thread state, and terminal state in the
  contract to protect current quality and community-memory behaviour.
- Reduced the output ceiling from 1,100 to 700 tokens, minified dynamic state JSON,
  and reduced duplicated technical prompt instructions.
- Added deterministic UI-state derivation, configured participation-option recovery,
  compact-output compatibility coverage, double-escaped newline normalisation, and
  multi-question active-reply repair.
- All 44 application test files pass with 318 tests; strict TypeScript validation and
  focused lint pass.

### Live result

- Replayed artist, curator, enthusiast, and hybrid identities successfully with
  evidence-backed `recommend` outcomes.
- Reduced the four-identity harness average from approximately 10.6 seconds to
  7.3 seconds, or about 31%.
- Across 26 model-backed messages, measured 8.4-second end-to-end p50 and 10.4-second
  p95; conversation-model time measured 7.7-second p50 and 9.4-second p95.
- Recorded remaining conversation-quality follow-ups: artist-plus-discussion can
  still over-promote to hybrid, a curator role question can repeat already-proven
  participation, and a hybrid maker disclosure can lose priority to the song route.

## Descriptive orientation

- Changed artist, curator, enthusiast, and hybrid orientation from a routing input
  into descriptive context for tone and the private reviewer record.
- Orientation labels and scores no longer add, remove, rewrite, force, or
  prioritise evidence goals.
- Conditional topics now become relevant from the applicant's explicit words. For
  example, unfinished-work feedback is eligible after evidence of feedback,
  curation, hosting, organising, unfinished work, or a comparable practice—not
  simply because an applicant is labelled curator or hybrid.
- Added compact-state relevance markers (`shared`, `explicit`, or `conditional`)
  and prompt rules preventing conditional goals from being selected without direct
  conversational support.
- Added regressions proving identical goal availability across orientation labels
  while preserving evidence-based safeguards for listeners and artists.

### Live verification

- Replayed artist, curator, enthusiast, and hybrid identities through `/doorcheck`;
  all four completed with evidence-backed `recommend` advisory reports.
- The artist and enthusiast were not asked about feedback. Their orientation labels
  remained descriptive and did not unlock that conditional goal.
- The curator reached a feedback question only after describing a monthly listening
  night; the hybrid reached it only after proposing an exchange around unfinished
  work. In both cases the applicant's words—not the stored orientation—made the
  topic relevant.
- Logged a separate continuity follow-up from the artist replay: the contribution
  question could still arrive without a natural bridge even though its eligibility
  was correct.
- Verification now passes 44 application test files and 319 tests, strict
  TypeScript validation, focused lint, and repository whitespace checks.

## Fluid orientation crossovers

- Added crossover relevance so artist, curator, and enthusiast descriptions remain
  fluid rather than becoming conversational lanes.
- Collaboration, co-creation, exchanging rough work, helping shape another
  artist's work, emerging curation, organising, hosting, and similar language can
  now make the feedback or care thread relevant regardless of stored orientation.
- Added a crossover bridge that follows a newly revealed practice or intention
  without announcing a relabelling or asking the applicant to qualify for another
  identity.
- Expanded maker recognition for curators or listeners who reveal that they have
  started making or uploading their own music.
- Kept credible future intentions available as conversational crossover evidence
  without converting them into current-practice orientation scores.
- Added regression journeys for artist-to-collaborator, enthusiast-to-curator, and
  curator-to-maker crossovers.

## Conversation control simplification

- Removed the accumulated-`thin` automatic close. Repeated low-information answers
  may still lead to an open-door question or a model recommendation, but only an
  explicit terminal decision, calibrated integrity boundary, or emergency loop stop
  can now force the neutral close.
- Made `usable` the baseline for clear relevant facts, intentions, creative media,
  COLORS reasons, preferences, and cultural judgments; `thin` is reserved for
  genuinely empty, evasive, non-responsive, or content-free answers.
- Removed server-side bridge-priority substitution. The validated model-selected
  bridge now remains authoritative instead of being replaced by another candidate.
- Stopped replacing a valid single-question model reply merely because another
  configured signal is open. Questions without a clean signal mapping are stored as
  conversational thread turns, and the following answer is not falsely attached to
  a different goal.
- Removed substring-based process-language rewriting, which could leave broken
  sentence fragments. Voice guidance remains in the model prompt; deterministic
  repair remains for safety, terminal-language leakage, repetition, missing or
  multiple questions, and structured inputs.
- Tightened orientation inference to current first-person practice. Admiring
  COLORS' curation and wanting to connect with artists no longer produce a curator
  or hybrid label.
- Rebuilt fallback reviewer evidence from both covered signals and the whole user
  transcript. Orientation is no longer used as the applicant bio or as a “one of
  seven relevant areas” denominator, and contextual statements remain visible even
  when they did not map to a configured goal.

### Exact-session replay

- Replayed the six applicant answers from the session that triggered this
  simplification. The conversation remained active after the final Lucki observation
  instead of discarding the model follow-up and forcing a close.
- Final orientation remained `artist` with a `0` curator score; admiration of COLORS'
  curation and a desire to connect with artists no longer produced a false hybrid.
- No budget-forced close or substring process-language rewrite occurred.
- The replay still exposed one model-level continuity weakness: a participation
  selector followed the poetic Lucki observation without first landing that detail.
  Added high-priority generation guidance for this case without introducing another
  server-side question rewrite.

## Mismatched-turn conversational repair

- Added a private answer-relation assessment independent of answer quality:
  `direct`, `partial`, `subject_shift`, or `ambiguous`.
- Subject shifts and ambiguous connections now open a one-turn clarification around
  the applicant's actual new detail instead of being forced into the preceding
  question or an invented bridge.
- Repair turns suppress model-proposed bridge and next-signal attachments, cannot
  automatically cover the preceding evidence intent, and keep the session active
  unless the emergency loop stop has been reached.
- Useful evidence explicitly present in the shifted answer may still be retained;
  relation mismatch is not treated as low answer quality.
- Persisted private repair metadata now makes these moments available for transcript
  auditing without exposing assessment mechanics to the applicant.
- Added unit, prompt-contract, parser, and runtime turn-lifecycle regressions using the
  `Lucki` project-question mismatch found in the exact-session replay.
- Verification passes 45 test files and 315 tests, strict TypeScript validation,
  focused production and unit-test lint, and repository whitespace checks.
