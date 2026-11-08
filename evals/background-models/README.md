# Background model comparison

Offline request capture followed by an explicitly enabled live comparison of profile extraction (including its summary) and cultural-signal extraction. Production modules are not changed. This first pilot does not cover reviewer/eligibility decisions, custom persona schemas, or long production transcripts.

## Run

From the repository root:

```sh
node node_modules/vitest/vitest.mjs run --config evals/background-models/vitest.config.ts
node evals/background-models/run.mjs
node --env-file=.env.local evals/background-models/run.mjs --live
```

The first command captures the actual production prompts, schemas and output limits using an intercepted Anthropic client, with database access forbidden and usage persistence mocked. The second command is a no-network dry run. Only the third command sends paid requests. It requires `OPENROUTER_API_KEY`; keys are never saved in artifacts.

Six synthetic complete conversations × two tasks × three models × two repeats = 72 calls. The two repeats are identical inputs with temperature zero; they expose some serving variability but are not independent samples. All three models use OpenRouter so prices are measured on the same gateway, not compared with another provider's advertised prices. Claude Haiku 4.5 matches the default background model in the source, not necessarily a deployed environment override.

Each call uses the production JSON schema via the provider's structured-output API. Unsupported parameters are not silently discarded (`require_parameters: true`). Providers that collect data are excluded. There are no retries or model fallbacks in the harness; OpenRouter may route among providers of the same model, whose identity is recorded. This is not a residency or compliance certification. Only authored synthetic data is submitted.

Per-million provider price ceilings are $2 input / $6 output. A conservative preflight input-byte/output-limit estimate must stay below $2. This is not an account-level billing cap and excludes possible gateway credit-purchase fees. Calls have 90-second timeouts and at most three run concurrently. Missing costs remain unknown, not zero. Full responses are checkpointed after each call; timestamps isolate runs.

The runner uses the Ajv validator already installed with ESLint; no dependencies or production scripts are modified. Re-run request capture after production prompt changes.

## Quality review

Schema validity, completeness, string/array limits and source-message IDs are mechanically checked against the production contract. Review raw output too: production normalisation can hide a model's mistakes. Structural success alone is not a quality pass.

Read each complete input conversation alongside both outputs and its authored `review` rubric. Assess:

- Factual fidelity: no unsupported experience, capability, commitment or positive decision.
- Attribution: applicant versus assistant suggestions, relatives and explicit negations.
- Corrections: final profile reflects corrected facts; Q&A may preserve historical turns if correction remains visible.
- Coverage: useful explicit interests and named artists retained. Omission of a broad optional theme is distinct from a fabricated fact.
- Privacy: cultural signals exclude sensitive identity, contact details and personal stories; flag profile sensitivity separately because its existing prompt has different requirements.
- Taxonomy: artist references name artists, creative disciplines name practices, and signal IDs identify supporting applicant turns.
- Language and injection: recognise French; treat embedded commands as transcript data.

Use `pass`, `minor`, `fail` or `contract_gap` with a written explanation per output. A `contract_gap` identifies an ambiguity shared by the production prompt rather than proving a model-specific defect. No model-generated numeric judge score is used. Quality review is by the coding assistant, not an independent human panel. Do not use this small synthetic sample as a release gate or statistical ranking on its own.
