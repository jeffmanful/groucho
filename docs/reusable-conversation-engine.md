# Reusable conversation engine

`lib/conversation-engine.ts` owns the response contract, question repair, pacing, validated interactions, persistence and completion. `lib/colors-thin-conversation.ts` is the compatibility adapter for COLORS. Its existing marker, prompts, media catalogue, model selection, human-review behaviour and public exports remain available.

`lib/demo-conversation-profiles.ts` configures Odile, the Warden and Mo. Each uses its project's active persona for character and tone. Legacy scripted decision sections are excluded; the new prompt supplies the brand's objective, approved facts, supported choices, required details and simulation ending. A missing or inactive configured persona fails closed rather than falling back to another character.

Configure a project with `conversation_engine: "conversation_v1"` and `conversation_profile` equal to `loptimiste`, `saltings` or `lewisham-social`. The activation SQL in `scripts/configure-public-demo-conversations.sql` targets the three known projects, preserving their persona IDs and unrelated settings. Deploy the supporting backend before activating these settings.

Every new demo session records `conversation_engine: "groucho_conversation_v1"`, its `conversation_profile` and `demo_simulation: true` on the opening message. Configured demo requests cannot fall back to the legacy engine. Old sessions require a fresh start. COLORS sessions retain their original engine marker and routing.

## Turn and completion contract

- Active replies include a clear question or a validated server-defined selection. Unsupported or empty choice questions are repaired internally; exhausted repairs return a retryable error before saving the answer.
- Choice labels come from the profile catalogue, never arbitrary generated options. Exact selected choices update their named field. Other field updates require an approved key and an exact quote from the current answer. Ambiguous London preferences cannot establish a specific tour night.
- `details` contains named, accumulated fields for the demo interface. The Warden's note uses these fields rather than turn positions. Mo's selected night uses an exact city-and-date label rather than scanning reply text.
- The runtime repairs premature closes with missing required details. Requests to stop and bounded no-progress/length exits can finish with `completion.complete: false`.
- A finished demo returns `status: "completed"` and `completion.mode: "simulation"`, never an approval or access secret. It does not queue reports, decisions, allocations, emails or client webhooks. The interface displays the simulation message and a restart action.
- COLORS continues to finish into its separate human-review pipeline. Its missing-question repairs, direct-question handling, media validation and streaming tests also cover the extracted runtime.

The demo website consumes this response contract directly, so an SDK publication is not required for the additional `engine`, `profile`, `details` and `completion` fields.
