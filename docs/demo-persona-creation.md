# Creating a demo persona

Use this guide for public demos on `conversation_v1`. Read [Reusable conversation engine](reusable-conversation-engine.md) for the implementation and rationale, and [Persona ownership](persona-ownership.md) for permissions, visibility and versioning.

## Write a brief first

| Decision | Specify |
| --- | --- |
| Purpose | What the conversation helps the visitor explore |
| Character | Name, role, vocabulary, warmth, pace and two short example replies |
| Approved context | Products, places, dates and facts it may rely on |
| Unknowns | What it must acknowledge it does not know |
| Required details | The smallest set for a useful ending, including acceptable refusals |
| Choices | Exact labels and the named field each choice updates |
| Boundaries | Relevant privacy concerns, corrections, stopping and topics outside scope |
| Ending | What was recorded and what actually happens afterwards |

Keep the purpose small enough for a short exchange. Separate having enough information from judging suitability. All current public demos end as simulations.

## Put each rule in the right place

| Layer | Owns |
| --- | --- |
| Database persona | Character, vocabulary, tone and style |
| Backend demo profile | Objective, approved facts, fields, registered options, opening and simulation ending |
| Shared engine | Question/choice validation, repair, grounded updates, pacing, persistence and closing |
| Website | Brand layout, actual option buttons, named summaries, pending/error/completion states |

A prompt cannot deliver buttons, reserve inventory or select an engine. Changing the prompt alone does not register a supported demo.

## Write the character prompt

Use concise behavioural instructions and concrete voice examples:

```text
You are Rowan, the host at an independent ceramics studio.
You are warm, observant and direct. Use plain English and short replies.
Notice one concrete detail rather than praising every answer.
Welcome first-time visitors and people unsure what they want to make.
Accept corrections without defending an old detail.
Do not invent classes, tutors, prices, available places or confirmed bookings.

Voice example: “A bowl for everyday breakfasts gives us somewhere to start.”
Avoid: “Perfect! You are exactly the kind of maker we are looking for.”
```

Keep operational facts, field requirements and option catalogues in the profile. Do not put pass/reject tokens, numeric scoring, rigid interview scripts or promised codes/emails in a new demo persona.

The composer normalises literal `\n` sequences and keeps persona text before a newline heading named `CONVERSATION FLOW` or `DECISION GUIDANCE`. It then appends the profile/runtime contract. This compatibility rule is not a general Markdown parser: do not put required character instructions below those headings or assume differently named legacy sections will be removed. Test the composed prompt.

## Create or choose the record

Use the authenticated admin persona workflow. Platform admins manage Groucho-owned originals through `/api/admin/personas`; organisation owners/admins can clone visible originals and edit their own copies. Follow the [ownership guide](persona-ownership.md).

Use a stable slug, make the persona active, and leave `is_default` false unless intentionally changing the platform fallback. Set the intended project's `settings.persona_id` to the actual UUID. Its organisation must own the persona or have access to the Groucho original.

The demo adapter rejects a different resolved persona: an inactive, missing or inaccessible record does not silently use the workspace default. Prompts are resolved during message handling, may be cached for a minute and are not pinned to a persona version per session. Start fresh sessions when testing edits.

`profile_schema` and `profile_extractor_hint` belong to a separate post-conversation pipeline. Public simulations do not queue it. Their live summaries use profile `fields` and returned `details`; defining a schema alone will not populate a demo summary.

## Register a backend profile

Add a stable ID to `DemoConversationId` and `DEMO_CONVERSATION_PROFILES` in `lib/demo-conversation-profiles.ts`. This illustrative entry is not already registered:

```ts
"studio-visit": {
  id: "studio-visit",
  opening: "Have you visited the studio before?",
  openingChoice: "visitType",
  objective: "Understand their studio experience and what they want to make.",
  guidance: "First-time makers are welcome. Ask about their idea without grading it. No class catalogue or live availability is supplied. Do not invent a price or booking.",
  closing: "Thank you for telling me what you have in mind.",
  completion: "Demo complete. No studio visit or class has been booked.",
  fields: [
    { key: "visitType", label: "Previous studio visits", required: true },
    { key: "idea", label: "What they would like to make", required: true },
  ],
  choices: {
    visitType: {
      field: "visitType",
      question: "Have you visited the studio before?",
      options: ["First visit", "I have been before"],
    },
  },
},
```

Define sufficient answers in `guidance`. An honest refusal or “I don't know yet” can be meaningful; do not invent a positive answer to satisfy a required field. Use `values` for fields limited to a fixed catalogue. Use distinct full labels for ambiguous items, such as two dates in the same city. The current ambiguous-place guard is tailored to comma-separated place/date labels; another catalogue may need different validation.

Each choice needs at least two distinct non-empty options and one clear question. Set `field` when selection should update details. `openingChoice` must reference a registered choice; align its wording with the opening. The website caps displayed options at twelve, so keep catalogues small or extend and test the contract first.

## Connect the project and website

1. Create or select the correct organisation/project and server-side project API key using the normal admin workflow.
2. Deploy backend support, then merge `persona_id`, `conversation_engine: "conversation_v1"` and the new `conversation_profile` into project settings. Keep project opening/closing values aligned with the profile. Preserve unrelated settings; the existing activation SQL targets only the original three demos.
3. In `groucho-demos`, extend `DemoBrand` in `app/demo-conversation.tsx` and `BRAND_KEY_ENV` in `app/api/groucho/[brand]/[...path]/route.ts`. Provision the matching server-only key environment variable.
4. Build the branded route using `useDemoConversation`, `DemoTranscript`, `DemoChoices` and `DemoStatus`. Bind summaries to named `details`, and retain pending, error, completion and restart states.
5. Extend test fixtures and `scripts/verify-demo-conversations.ts`, which currently targets only the three existing profiles.

The frontend companion lives in [groucho-demos](https://github.com/thompson-mcdonald/groucho-demos), under `docs/conversation-engine.md` and `docs/persona-creation.md`. Read the installed Next.js guides required by `AGENTS.md` before implementing a page.

## Evaluate before launch

| Scenario | Expected result |
| --- | --- |
| Ordinary visitor | Useful questions, required details and a short ending |
| Several details at once or out of order | Correct named summary, without needless repeated questions |
| Gift, beginner, person alone or unable to attend | No invented eligibility requirement or negative judgment |
| Refusal, uncertainty or “Can we stop?” | Honest handling; stopping may return `complete: false` |
| Selection | Actual buttons match the catalogue; answered selectors do not repeat |
| Ambiguous date/place or correction | Clarify the exact item and display the corrected preference |
| Model observation or unsupported selector | Internal repair, or visible retryable error before saving that answer |
| Unavailable persona, wrong profile or old session | Visible failure, without another character or legacy fallback |
| Temporary request failure | Pending clears, text remains and restart is available |
| Completion | Composer/options disappear; explicit simulation outcome and restart appear |

Use mocked tests for deterministic failures, API walkthroughs for the deployed path and browser checks for rendering. Live scripts create records and incur usage: use synthetic identities. Make synthetic writing answers self-contained, such as “A line from my draft is…”, instead of repeating an unexplained quotation to a different follow-up.

Inspect opening engine/profile metadata, final details/completion and absence of completion jobs. Run COLORS regressions when changing the engine, and check every demo when changing the shared controller. Fix behaviour common to personas in the shared layer instead of accumulating prompt workarounds.

Record the launch date, commits, model/configuration, failures and verification results. Do not commit credentials or real visitor transcripts. For real booking, ticketing or application submission, design and verify that integration before changing the public promise.
