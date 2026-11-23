# Project conversation flow wizard — 23 November 2026

## Change and expected conversation effect

Will this change positively or negatively affect the conversation experience? Expected positive effect: clients can explicitly choose an opening and shape project-specific progression and closing, while signals guide understanding rather than enforcing a script. Tradeoff: two more setup steps and more optional writing. Controls are separated into purpose/context, persona, conversation flow, signals/examples, and test/save, with useful defaults and optional guidance.

The opening question is always editable, independent of signal questions. Approved project context is distinct from the objective and personality. Optional progression and closing guidance enter the same runtime prompt in preview and saved execution. The configured final statement is appended by the shared engine; it cannot contain a question. Stops and answer ceilings override unfinished flow steps. This is natural-language guidance, not a deterministic workflow graph.

Version-1 runtime support is retained. Older version-2 settings omit the four new fields and retain their stored revision/defaults. Canonical validation makes revision hashes independent of JSON property order. The wizard presents an older project's effective opening as an editable field. Configuration changes require a fresh preview before saving. No database migration is needed.

## Client entry points

Verified in the actual browser: organisation dashboard → Projects → New project opens the wizard directly. An existing custom project exposes Setup, which reopens the same wizard. These entry points use existing organisation owner/admin or platform-admin access. Philip's existing account remains demo-only; no authentication or permission changes are part of this work. The changes are local and not deployed.

## Browser validation

Used the development dashboard account, not Philip's identity. Updated the existing synthetic test project, **Philip test - Alex community host**, in Development. Project ID: `fa1f36ee-9b1f-42b3-91a2-a3823fe84016`.

- Walked all five steps, edited the opening independently of the first signal, and retained both signals/examples.
- Verified validation rejects a final closing message containing a question and focuses the error.
- Verified a project-context edit makes the preview stale and disables Save until restarted.
- Ran complete real-model conversations, including project questions, third-party accounts, a correction and stopping.
- Saved the new controls through the UI; authenticated project GET returned 200 with all five project controls populated. Reopened Setup and confirmed the custom opening persisted.
- Clicked New project from the actual Projects page and confirmed a fresh wizard with editable default opening and closing statements. Discarded this unsaved smoke-test draft.
- Inspected desktop and 390px mobile screenshots. Existing CSS provides wrapping/stacking, focus styles and 44px controls; no new styling system or animation was introduced.

Screenshots: `output/playwright/project-conversation-flow-desktop.png` and `output/playwright/project-conversation-flow-mobile.png`.

## Full-conversation review

Reviewed complete conversations for continuity, warmth, curiosity, useful contribution, attribution and corrections. Initial samples exposed third-party context being labelled partial applicant evidence, a supplied fact being treated as unknown, and corrected evidence remaining stale when the correction accompanied a stop. Strengthened the shared project prompt's fact/attribution policy and the signal response contract so evidence updates are independent of the spoken closing decision. This does not add phrase-specific response rewriting or a new model call.

The final sample below answered the known cost and unknown date separately, did not source the sister's activity as applicant evidence, acknowledged a correction, replaced the superseded contribution quote with Answer 2, used the configured final statement and closed without another question. No external action or acceptance decision was promised. Both signals remained Partly understood; that is a model interpretation, not a rejection. Style is still sometimes more affirming/verbose than the persona preference, and a follow-up can ask for more detail after a useful initial account. These samples establish the tested behaviour, not deterministic prose or perfect semantic extraction.

### Final complete browser conversation

**Alex:** Hi, I’m Alex. I’d like to hear about the communities you’re part of and what you’d enjoy contributing. What would you like to find in a new creative community?

**You:** I would like a gentle place to share unfinished writing. I welcome newcomers to an online writing group because I remember feeling nervous when I joined. My sister runs a supper club; that is her activity. I could bring short writing prompts because I have enjoyed sharing them with friends online. Is attendance at this project free, and has the next date been announced?

**Alex:** Attendance here is free, with no charge, and beginners and informal participation are welcome. The next date hasn't been announced yet, and there's no booking process set up at the moment. You mentioned bringing short writing prompts; have you been part of an online group where you've shared those with friends?

**You:** Small correction: I shared those prompts with friends in person, not online. The writing group where I welcome newcomers is online. Please stop here; I do not want to add anything more.

**Alex:** Thanks for the correction, I've noted that the prompts were shared with friends in person. Thanks for sharing your ideas for this community.

### Earlier complete run that exposed interpretation problems

**Alex:** Hi, I’m Alex. I’d like to hear about the communities you’re part of and what you’d enjoy contributing. What would you like to find in a new creative community?

**You:** I would like somewhere gentle to share unfinished writing. My sister runs a neighbourhood supper every week. I could offer short writing prompts because I have enjoyed doing that with friends online.

**Alex:** That sounds like a lovely kind of space, somewhere unfinished writing can be shared gently. I like that you've already enjoyed running prompts with friends online. Is there a group or community you keep coming back to, whether online or in person?

**You:** Just to be clear, the supper is my sister, not me. I take part in an online writing group by welcoming newcomers because I remember feeling nervous when I joined. Are these gatherings free, and when would the next one be?

**Alex:** Thanks for clarifying that the supper is your sister's, and I'm glad you shared how you welcome newcomers to your online writing group. On your questions, I don't have details about whether these gatherings are free, and no dates have been announced yet, so I can't tell you when the next one would be. What do you enjoy most about welcoming someone who is new to a group?

**You:** Helping them feel less nervous is what I enjoy. That is all I wanted to add, thank you.

**Alex:** Thank you, Alex here. Thanks for sharing your ideas for this community.

## Verification

- Full suite with local socket access: **934 passed, 7 skipped, 3 failed** (944 total). The failures are the existing synthetic culture route load tests at 2/100/200 users, reporting unexpected synthetic completion/missing details. The same failures were already reproduced against unchanged HEAD during the original wizard work; see `project-signals-wizard-2026-11-16.md`. No load-test fixtures/assertions were changed.
- Initial sandboxed suite: 932 passed, 7 skipped, 5 failed because the synthetic provider could not listen on localhost (`EPERM`). Re-ran with local socket access for the result above.
- All 62 project-conversation tests pass in the full suite. Added persistence/validation, independent-opening choice behaviour, canonical revision compatibility, new-session requirements on flow changes, preview/saved parity, custom closing at stop/limit, and correction-plus-stop evidence replacement coverage.
- TypeScript `pnpm exec tsc --noEmit`: passed.
- ESLint on the wizard, configuration/runtime, shared conversation engine and project-conversation tests: passed. Global `**/.next/**` exclusion is preserved.
- Production `pnpm build`: passed with normal local process/network permissions. The first sandboxed build stalled during compilation and was terminated before retrying.

The test project remains Testing in Development. Existing integrations, live projects and Philip's access were not changed. No deployment or commit was made. Unrelated pre-existing privacy changes in the working tree were preserved.
