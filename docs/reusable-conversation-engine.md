# Reusable conversation engine

Implemented 2 November 2026. For future demos, read this architecture guide and [Demo persona creation](demo-persona-creation.md). The companion [groucho-demos repository](https://github.com/thompson-mcdonald/groucho-demos) documents the website in `docs/conversation-engine.md`.

## Why the demos moved to this engine

The public demos used the older gatekeeper flow while COLORS already had a newer conversational runtime. Prompt changes alone could not supply the missing runtime and interface guarantees.

| Observed problem | Change | Why |
| --- | --- | --- |
| An active reply was an observation without a next question | Validate questions and attempt up to two repairs | Every active turn needs a clear way to answer |
| A persona introduced multiple choice without visible options | Server-registered choices plus an explicit UI contract | Prose describing a choice does not create buttons |
| An answered attendance choice appeared again | Repair selectors whose named field is already known | Use the answers already recorded |
| A conversation finished before collecting important details | Required fields and premature-close repair | Completion must reflect the conversation's purpose |
| Endings implied a reservation, shortlist or code | Explicit simulation completion, without completion jobs | The demos do not fulfil purchases, applications or tickets |
| Warden notes depended on turn positions; London meant two dates | Named details and exact approved date labels | Natural conversations change order and contain corrections |
| Three pages duplicated conversation handling | Shared backend runtime and website controller | Future fixes should reach every demo |

The migration preserves the three configured persona IDs. It replaces their legacy scripted outcomes with the new contract, while keeping their character. COLORS' membership criteria, character and media are not copied into the demos.

## Runtime boundaries

```text
Demo page -> brand proxy -> project API key / project settings
         -> session start + engine routing
         -> demo profile + active database persona
         -> shared conversation engine -> website controller

COLORS callers -> COLORS compatibility adapter -> shared engine
```

| Source | Responsibility |
| --- | --- |
| `lib/conversation-engine.ts` | Response validation, repair, pacing, interactions, grounded details, persistence and closing |
| `lib/demo-conversation-profiles.ts` | Brand objectives, approved facts, fields, choices, prompt composition and simulation endings |
| `lib/start-gatekeeper-session.ts` | Opening message, opening interaction and engine/profile metadata |
| `lib/colors-engine-routing.ts` | Engine selection, including public demos despite the historical filename |
| `lib/persona-resolution.ts` | Active persona lookup and organisation access |
| `lib/colors-thin-conversation.ts` | COLORS adapter and stable exports |
| `lib/colors-conversation-profile.ts` | COLORS prompt and consent wording |

## Configuration

`lib/conversation-engine.ts` owns the response contract, question repair, pacing, validated interactions, persistence and completion. `lib/colors-thin-conversation.ts` is the compatibility adapter for COLORS. Its existing marker, prompts, media catalogue, model selection, human-review behaviour and public exports remain available.

`lib/demo-conversation-profiles.ts` configures Odile, the Warden and Mo. Each uses its project's active persona for character and tone. Legacy scripted decision sections are excluded; the new prompt supplies the brand's objective, approved facts, supported choices, required details and simulation ending. A missing or inactive configured persona fails closed rather than falling back to another character.

Configure a project with `conversation_engine: "conversation_v1"` and `conversation_profile` equal to `loptimiste`, `saltings` or `lewisham-social`. The activation SQL in `scripts/configure-public-demo-conversations.sql` targets the three known projects, preserving their persona IDs and unrelated settings. Deploy the supporting backend before activating these settings.

Every new demo session records `conversation_engine: "groucho_conversation_v1"`, its `conversation_profile` and `demo_simulation: true` on the opening message. Configured demo requests cannot fall back to the legacy engine. Old sessions require a fresh start. COLORS sessions retain their original engine marker and routing.

Example project settings, merged with existing settings rather than replacing them:

```json
{
  "persona_id": "<active-persona-uuid>",
  "conversation_engine": "conversation_v1",
  "conversation_profile": "loptimiste",
  "application_experience": {
    "max_turns": 8,
    "preferred_input_types": ["text", "singleSelect"]
  }
}
```

The project setting is `conversation_v1`; the response/metadata marker is `groucho_conversation_v1`. Only the three registered profile IDs are currently supported. Creating an arbitrary persona or slug does not register a new demo.

The profile supplies its opening and closing. Changing only the project opening text does not change the demo runtime opening; keep those values aligned. An invalid profile or unavailable configured persona returns `503`; incompatible session markers/profiles return `409` and require a fresh start. The adapter requires the resolved persona ID to equal `settings.persona_id`, preventing fallback to a different character.

Engine selection and model selection are separate. Demo profiles call `colorsThinConversationModel()` in `lib/gatekeeper-models.ts`: `GROUCHO_COLORS_THIN_CONVERSATION_MODEL` overrides `GROUCHO_GATEKEEPER_CONVERSATION_MODEL`, then the code default applies. Changing a persona does not select a model. Record model configuration during evaluation; an override can affect both COLORS and these demos.

| Profile | Character | Required details | Choices |
| --- | --- | --- | --- |
| `loptimiste` | Odile | `recipient`, `scentMemory`, `burnLocation` | `recipient`, optional `ritual` |
| `saltings` | The Warden | `workingOn`, `stuck`, `wants`, `line`, `attendance` | `need`, `attendance` |
| `lewisham-social` | Mo | `discovery`, `companion`, `location`, `night` | `discovery`, `night` |

A required detail can record an honest refusal or limitation, such as declining to share a line, coming alone or being unable to attend. Required does not mean a favourable answer is required. Dates, availability and the numbered candle are illustrative context, not live inventory.

## Turn and completion contract

- Active replies include a clear question or a validated server-defined selection. Detected unsupported or empty choice questions are repaired internally; exhausted repairs return a retryable error before saving the answer.
- Choice labels come from the profile catalogue, never arbitrary generated options. Exact selected choices update their named field. Other field updates require an approved key and an exact quote from the current answer. Ambiguous London preferences cannot establish a specific tour night.
- `details` contains named, accumulated fields for the demo interface. The Warden's note uses these fields rather than turn positions. Mo's selected night uses an exact city-and-date label rather than scanning reply text.
- The runtime repairs premature closes with missing required details. Requests to stop and bounded no-progress/length exits can finish with `completion.complete: false`.
- A finished demo returns `status: "completed"` and `completion.mode: "simulation"`, never an approval or access secret. It does not queue reports, decisions, allocations, emails or client webhooks. The interface displays the simulation message and a restart action.
- COLORS continues to finish into its separate human-review pipeline. Its missing-question repairs, direct-question handling, media validation and streaming tests also cover the extracted runtime.

The demo website consumes this response contract directly, so an SDK publication is not required for the additional `engine`, `profile`, `details` and `completion` fields.

The model uses `groucho_converse` or equivalent structured output; profiles add `choiceKey` and proposed `facts`. A registered key supplies the canonical question and options and can replace the model's reflection on that turn. Text is trimmed to its first question. The unsupported-choice detector is not a semantic check of every possible paraphrase.

Fact values must be non-empty, at most 500 characters, and supported by a quote contained in the current answer, compared without case sensitivity. Enumerated fields accept approved values only. Quote matching supports grounding but cannot independently prove every model paraphrase correct. API-required numeric `scores` remain neutral placeholders, not demo assessments.

Repairs happen before saving the user/assistant pair. An exhausted repair returns retryable `503` without saving that answer. Save failures have rollback handling; this is not a general exactly-once or concurrent-request guarantee.

## Completion and stopping

Demo pacing asks for wrap-up at seven applicant answers, uses a soft close at ten and derives an emergency limit from `max_turns` (eleven for the current setting of eight). Direct questions and consent handling have continuation exceptions. Do not promise an unconditional eight-turn limit.

A completed public demo returns `reviewStatus: "not_required"` and a completion object such as:

```json
{
  "mode": "simulation",
  "complete": false,
  "message": "Demo complete. This note has not been sent and no residency application has been submitted."
}
```

Here `complete: false` means the conversation ended before all required details were collected. It is not an API error or rejection. `complete: true` means the details were captured, not that the visitor qualified for an allocation. Recognised explicit stop requests, consent handling and bounded no-progress/length exits can end incomplete.

The adapter forces `runCompletion: false`; the runtime independently suppresses completion jobs when a simulation completion message is configured. Demo completion does not mark a COLORS report as pending. The interface hides the composer/options, displays the ending and offers a restart.

COLORS retains its original marker, prompt, media, exports and separate assessment/human-review pipeline through its adapter. Other gatekeeper projects and onboarding are not automatically migrated. A real fulfilment flow needs a separate verified integration; changing the completion copy alone is insufficient.

## Deployment and recovery

1. Back up the affected project settings and record compatible backend/frontend deployments.
2. Deploy backend support first. The activation SQL targets the three original project IDs/slugs; do not reuse it unchanged for a new demo.
3. Merge the engine/profile settings into the intended projects, preserving persona IDs and unrelated settings. No schema migration is needed for this settings update.
4. Deploy the website consuming the new contract. Coordinate activation and frontend rollout: the new UI requires the new marker.
5. Start fresh sessions and verify the public proxy path. Project/persona lookups can be cached for about 60 seconds.

Rollback must restore compatible website/backend deployments and saved settings together. Rolling back backend code alone while keeping the new settings/UI is incomplete. The implementation is tracked in [backend PR #10](https://github.com/jeffmanful/groucho/pull/10) and [website PR #1](https://github.com/thompson-mcdonald/groucho-demos/pull/1); both must be merged for subsequent main-branch deployments to retain it.

`ANTHROPIC_API_KEY` belongs to the backend deployment, not the demo website. Account credits do not validate a different or revoked deployed key. Environment changes require a deployment using the new value. Never copy credentials into prompts, browser code, docs or test output.

## Verification record and commands

With dependencies and the normal backend environment available:

```bash
pnpm exec vitest run lib/__tests__/demo-conversation-engine.test.ts lib/__tests__/colors-engine-routing.test.ts lib/__tests__/colors-thin-question-close.test.ts
pnpm exec tsc --noEmit --incremental false
node --env-file=.env.local --import tsx scripts/verify-demo-conversations.ts --public
```

The public script creates synthetic sessions and makes billable model calls through `demos.grcho.com`; `GROUCHO_DEMO_SITE_URL` can select another host. Without `--public`, it overlays settings for direct handler calls using local server credentials. That mode does not verify deployed settings/proxy behaviour. Transcripts are written to `/tmp/reusable-conversation-live-verification.json`.

On 2 November 2026, 745 backend tests passed with two skipped, plus four website contract tests. Final public walkthroughs for all three demos completed with required details. Database checks confirmed the new marker, no pending report status and zero completion jobs. Browser checks covered all endings, options, the Warden's named note and exact London Sunday highlighting. A live “Can we stop?” ended incomplete with `reviewStatus: "not_required"`. Local browser checks covered retaining an answer after temporary `503`, without duplicate transcript entries.

This is a dated verification record. Free-text follow-ups can still repeat, model summaries still need evaluation, and a lost HTTP response after server persistence is not solved by client duplicate-send prevention. Include these cases in future persona testing.
