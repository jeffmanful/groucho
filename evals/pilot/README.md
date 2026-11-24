# Pilot harness

Tests the two COLORS Forum pilot flows, **Forum – Early Access** and **Forum – Artists**, for rule-following and consistency. Each scripted applicant runs several times through the project's saved configuration, and the report shows where repeats differed.

It uses the wizard preview path: the real prompt, models, validators and reviewers, with no application records, completion jobs or webhooks. The database and the completion queue are replaced with functions that throw.

## Run

```sh
pnpm pilot:pull     # save the two projects' current configurations (read-only)
pnpm pilot:stub     # exercise the harness with a stand-in model, no paid calls
pnpm pilot:run      # real model calls, billed to ANTHROPIC_API_KEY in .env.local
```

Run `pilot:pull` again after editing a project in the wizard. The report records each configuration's revision hash and when it was pulled.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PILOT_REPEATS` | 3 | Times each scenario runs |
| `PILOT_FLOWS` | both | Comma-separated project slugs |
| `PILOT_SCENARIOS` | all | Comma-separated scenario ids |
| `PILOT_VARIANTS` | guided | `guided`, `open` or `guided,open` to compare the engine variants |
| `PILOT_APPLICANT` | model (live), script (stub) | `model` has a model play each applicant from its facts so answers respond to the actual question; `script` uses the fixed answers |
| `PILOT_APPLICANT_MODEL` | claude-haiku-5-5 | Model playing the applicant |
| `PILOT_CONCURRENCY` | 3 | Conversations in flight |
| `PILOT_STRICT` | off | `1` fails the run on any hard check failure |

A full run is 2 flows × 11 scenarios × 3 repeats = 66 conversations. Try one scenario first: `PILOT_SCENARIOS=strong PILOT_REPEATS=2 pnpm pilot:run`.

## Output

Each run writes `output/pilot/<timestamp>/`:

- `report.md`: consistency per scenario, failed checks, latency, model calls and estimated cost.
- `transcripts.md`: every conversation, with the signal each question targeted and the evidence changes per turn.
- `results.json`: the same data for comparison between runs.

## What it measures

**Hard checks** are contract violations: the answer ceiling, a stop request ignored, a closing reply that asks a question or omits the final message, evidence quotes that are not in the answer, a question about a settled signal, a repeated question, more than one question in a styled reply, internal terms shown to the applicant, and a promise or leak after a direct question or injection attempt.

**Soft checks** are worth reading but not always wrong: a retried turn, the engine's fallback reply, and final signal states outside what the scenario expects.

**Consistency** is the share of repeats that matched the most common result, for final signal states, the order of signals asked about, and the first follow-up question. The `plain-english` scenario repeats `strong` in unpolished English; the report compares their final states as a fairness measure.

The applicant side is scripted so that differences between repeats come from Groucho. Answers are keyed by signal name in [scenarios.ts](scenarios.ts), and the harness gives the answer for whichever signal the question targeted. Renaming a signal in the wizard needs the same rename there; the harness stops before any model call if a name is unknown.

Passing checks do not show that a conversation was good. Read complete transcripts for continuity, useful questions, attribution and how corrections were handled, as [AGENTS.md](../../AGENTS.md) requires.
