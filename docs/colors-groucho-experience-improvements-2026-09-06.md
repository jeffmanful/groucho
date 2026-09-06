# COLORS Groucho experience improvements

Date: 2026-09-06  
Status: Implemented and validated  
Scope: The gatekeeper experience rendered for the COLORS organisation in `app/doorcheck/page.tsx`

## Feedback received

1. Choose one pattern for the post-submit message instead of showing both a reading message and “Groucho is replying.”
2. Make the incoming reply feel smoother and less sudden.
3. Reduce the information at the bottom of the experience to the absolute essentials.
4. Keep the appealing faded-orange treatment, but make sure its meaning is clear and consider using it as part of one unified reading/replying state.

Product clarification: project, persona, environment, and session metadata must remain available behind a menu rather than being removed.

## Product interpretation

Treat the time between submit and the next question as one continuous state, not two separate “reading” and “replying” states. The user does not benefit from the system exposing that internal distinction.

Recommended user-facing model:

| State | Primary message | Input | Submit control | Question area |
| --- | --- | --- | --- | --- |
| Ready | No status copy | Editable | Neutral enabled treatment when text is present | Current question is stable |
| Reading | `Groucho is reading…` | Disabled; keep the submitted answer visible | Warm accent activity treatment | Current question remains stable |
| Revealing | No status copy | Hidden or disabled | Warm accent resolves back to neutral | Old question exits softly; new question fades/types in |
| Ready again | No status copy | Editable and focused | Neutral enabled treatment | New question is fully legible |

“Reading” is the recommended label because it acknowledges the user's answer. “Replying” describes an implementation detail and currently appears only as placeholder copy in a disabled, emptied field.

The warm orange should communicate “Groucho is active,” not “disabled” or “warning.” Motion must not be the only cue: pair the color with the reading label and an accessible live-region update. The send arrow should remain neutral in ready/disabled states; during reading it can cross-fade to a small activity mark using the same warm accent as the status.

## Current-state findings

Review mode: full  
Framework: Next.js 16, React 19, Tailwind utilities, component-scoped global CSS, and Motion (`motion/react`)  
Review boundary: COLORS gatekeeper path on desktop, source-level responsive/reduced-motion review; no authenticated application submission was made during discovery.

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | Question, status, input placeholder, metadata, credit | 1 medium finding |
| Surfaces | Answer shell, send control, footer metadata | 1 medium finding |
| Animations | Loading/status handoff, typewriter, question replacement, image transition | 1 medium finding |
| Icons | Send arrow and reading dot | 1 low finding |
| Performance | Motion layout spring, image `will-change`, typewriter timer | Clear for the planned scope |

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `app/doorcheck/page.tsx:1334`, `app/doorcheck/page.tsx:1614` | `Reading your answer…` is shown while the disabled input simultaneously says `{personaName} is replying…` | Use one `reading` presentation with one label and one visual treatment | Competing labels make one system state feel like two processes and increase uncertainty |
| MEDIUM | `app/doorcheck/page.tsx:905`, `app/doorcheck/page.tsx:966`, `app/doorcheck/page.tsx:1322` | The response commits directly to `messages`; the question content changes immediately, its typewriter restarts, and loading clears separately | Introduce an explicit `reading -> revealing -> ready` handoff; softly exit the old content before revealing the new content | Several unsynchronised updates can briefly overlap and make the reply appear abrupt |
| MEDIUM | `app/doorcheck/page.tsx:1691`, `app/doorcheck/page.tsx:1705`, `app/doorcheck/page.tsx:1719`, `app/doorcheck/page.tsx:1736` | Project, persona, project type, session mode, and Groucho credit all sit below the primary action | Move project, persona, environment, and session details into one secondary settings menu; retain only required attribution in the main layout | Secondary implementation details compete with the answer field at the key interaction point |
| LOW | `app/doorcheck/page.tsx:1642`, `app/doorcheck/page.tsx:1907` | The same submit surface changes mainly through opacity/background, so its warm faded state can read as disabled, active, or warning | Give ready, disabled, and reading distinct combinations of icon, label, opacity, and color; animate the arrow/activity-mark swap | Color alone is ambiguous and can conflict with established button-state expectations |

## Proposed interaction specification

### 1. One status pattern

- Replace both existing phrases with `Groucho is reading…`.
- Render it once, adjacent to the answer control, in a polite live region.
- Keep the user's submitted answer visible during reading so the transition has continuity.
- Do not show a second busy message in the textarea placeholder.
- Use the persona-independent name “Groucho” for COLORS unless product explicitly wants a named persona exposed.

### 2. Smooth response handoff

- Add a small UI phase independent from the request boolean: `ready | reading | revealing`.
- On submit, capture the submitted answer, enter `reading`, and keep the current question in place.
- When the response arrives, store it as pending rather than immediately replacing the current question.
- Exit the reading treatment in about 150–180 ms with a small upward translation and opacity fade.
- Cross-fade the old and new question in a fixed-height stage so layout does not jump. Use opacity plus no more than 6–8 px vertical movement; avoid stacking a container entrance on top of the character-by-character reveal.
- Choose one reply-reveal motion. Recommendation: retain the typewriter as the primary reveal, but soften its first frame with a 180–240 ms opacity transition. Do not also animate the entire question from 14 px with blur.
- Reveal the input after the question completes, then restore focus. Under reduced motion, replace all staged movement and typing with an immediate text swap plus the static status change.
- Remove timeout-based ownership of the handoff where possible. Completion should be driven by explicit phase transitions, with a defensive timeout only as a fallback.

### 3. Essential bottom area and settings menu

For the COLORS participant experience, the bottom area should contain only:

- the answer field or structured choices;
- the submit/continue control;
- validation or request errors when present;
- “Powered by Groucho” only if attribution is contractually or strategically required.

Move project selection, persona selection, environment, and session information into one menu outside the answer area. The recommended trigger is a compact `Settings` control in the existing top-right utility group beside Listen and Sign out, avoiding another floating control near the composer.

Menu requirements:

- Use the visible label `Settings` with a single consistent outline icon; do not rely on an unexplained ellipsis.
- Give the trigger a 44 × 44 px minimum hit area and expose `aria-expanded`, `aria-haspopup="dialog"`, and the panel's accessible name.
- Put editable Project and Persona controls first, followed by a quiet read-only Environment and Session section.
- Close on Escape, outside click, project/persona selection, and route change; return focus to the trigger.
- Keep the menu in the DOM only while open so hidden form controls do not remain in the tab order.
- Use a restrained opacity/translate transition of 150–180 ms, with no custom entrance under reduced motion.
- On narrow screens, use the same trigger and content in a compact anchored panel or bottom sheet, provided it does not obscure the answer field.
- If these controls are intended only for previews, show the trigger only to authenticated/internal viewers while preserving the same menu structure.

Do not merely lower the metadata's opacity in the main layout; visually quiet controls still add density and remain focusable.

### 4. Warm accent semantics

- Ready with no answer: neutral, low-contrast disabled button.
- Ready with an answer: neutral light enabled button.
- Reading: warm faded-orange activity mark and status text, with the send arrow cross-fading to the activity mark.
- Revealing: warm accent fades out as the new question appears.
- Error: retain red; never reuse the warm activity color for errors or warnings.
- Apply the same semantic treatment to text, mark, and button state so the color has one meaning across the flow.

## Implementation plan

### Phase 1 — Consolidate state

1. Introduce a COLORS interaction phase (`ready`, `reading`, `revealing`) and a pending assistant message.
2. Derive input availability, status visibility, send-control appearance, and question reveal from that phase.
3. Remove the loading placeholder that says the persona “is replying.”
4. Preserve existing onboarding behavior and non-COLORS gatekeeper behavior.

Deliverable: one source of truth for the post-submit experience, with unit coverage for allowed transitions.

### Phase 2 — Refine the handoff motion

1. Give the question stage a keyed presence transition with `initial={false}`.
2. Use a short, softer exit and a slightly longer enter; keep the stage dimensions stable.
3. Let the typewriter own the detailed reply reveal instead of layering a second large entrance animation over it.
4. Restore the answer area only after reveal completion.
5. Add an explicit reduced-motion path.

Deliverable: no overlapping status/reply frames, no question-stage layout jump, and no delayed blank state on fast responses.

### Phase 3 — Simplify the bottom area

1. Create one accessible settings menu using the existing Tailwind and Motion conventions.
2. Move Project and Persona selectors plus Environment and Session details into the menu.
3. Place the trigger in the top-right utility group and remove the corresponding controls and metadata from below the answer field.
4. Restrict the trigger to authenticated/internal viewers if these options are preview-only.
5. Confirm whether “Powered by Groucho” is mandatory; retain it only if required.
6. Check desktop and mobile spacing after the move and reclaim the vertical space for the answer field.

Deliverable: the bottom area contains only task-critical controls and any required attribution, while configuration and metadata remain available from one menu.

### Phase 4 — Unify accent behavior

1. Define semantic tokens for ready, active-reading, disabled, and error states rather than tying the color directly to a component.
2. Cross-fade the send arrow to an activity mark during reading using opacity, scale, and blur; keep the transition interruptible and pair it with text.
3. Verify contrast in every state and ensure focus styles remain visible.

Deliverable: the warm orange consistently means active processing and cannot be mistaken for disabled, warning, or success.

### Phase 5 — Validate

Test this matrix:

| Scenario | Expected result |
| --- | --- |
| Empty answer | Submit is disabled and neutral; no warm activity cue |
| User types | Submit becomes enabled without implying loading |
| Submit / normal response | One reading label; answer remains visible; reply handoff is continuous |
| Very fast response | No flash, stacked messages, or skipped exit |
| Slow response | Reading state remains calm and does not repeatedly attract attention |
| Error | Submitted answer can be recovered; error is distinct from reading |
| Reduced motion | No typewriter, pulsing, translation, or image transition dependency |
| Keyboard | Focus order excludes hidden preview controls; focus returns to the answer field |
| Settings menu | Trigger exposes state; Escape and outside click close it; focus returns to the trigger |
| Screen reader | One polite reading announcement and one new-question announcement |
| Mobile and desktop | No footer collision, clipped input, or vertical jump |

Run the relevant lint/type checks and inspect the transition at normal speed and at 10% speed in browser animation tooling. Record before/after clips for product review.

## Acceptance criteria

- Only one user-facing processing message appears after submit.
- The system never shows “reading” and “replying” simultaneously.
- The previous question, reading state, next reply, and restored input form a continuous visual sequence.
- Fast and slow responses follow the same state order.
- The COLORS participant footer contains no project, persona, environment, or session-mode controls; all four are available from one settings menu.
- The settings menu is keyboard accessible, does not leave closed controls in the tab order, and works without motion.
- Warm orange has one documented meaning and is never the only indicator of state.
- Reduced-motion and keyboard/screen-reader paths remain complete.
- The non-COLORS and onboarding flows have no visual or behavioral regressions.

## Implementation outcome

- Added the explicit `ready → reading → revealing` lifecycle for the COLORS gatekeeper flow.
- Kept submitted text and selected choices recoverable while reading and after request errors.
- Delayed the incoming Groucho message until the single reading cue has exited, then used a keyed, fixed-stage question handoff before the existing typewriter reveal.
- Unified the warm orange across the reading label, activity mark, and send-control icon swap; it is paired with accessible status text rather than used as a color-only signal.
- Moved Project, Persona, Environment, and Session into the top-right Settings panel. The panel closes on Escape, outside click, and selection; Escape returns focus to its trigger.
- Removed COLORS project/session controls from the answer footer, leaving the answer controls, errors, and current Groucho attribution.
- Corrected the Overused Grotesk asset paths so the intended font loads during visual review.

Validation completed: TypeScript passed, all 321 tests passed, the production build completed, and desktop/mobile browser checks confirmed the Settings panel remains in the viewport, has an accessible name, and returns focus on Escape. The targeted lint check still reports two pre-existing `set-state-in-effect` findings in the page's session/bootstrap effects.

## Considered but rejected

| Location | Candidate | Rejected because |
| --- | --- | --- |
| Loading copy | Show sequential `Reading…` then `Replying…` messages | It exposes an internal distinction without helping the user and lengthens a frequent interaction |
| Reply reveal | Remove all motion and show the full reply immediately | It would solve abrupt animation bugs but lose the deliberate conversational pacing that is already part of the COLORS experience |
| Bottom metadata | Keep all controls and reduce their opacity further | Density and keyboard focus remain even when the controls are visually faint |
| Bottom metadata | Remove project, persona, environment, and session information entirely | These details still need to be available for configuration and diagnosis; the menu preserves access without competing with the answer field |
| Warm accent | Use orange for every enabled primary action | It weakens the proposed “Groucho is active” meaning and risks reading as a warning or generic brand color |

## Discovery verification

- Inspected the COLORS gatekeeper branch, submit lifecycle, question/typewriter implementation, Motion variants, answer area, internal selectors, attribution, CSS state colors, and reduced-motion rules.
- Loaded the local `/doorcheck` experience at desktop size and confirmed the visible COLORS footer contains the project selector, persona selector, technical project/session line, and Groucho attribution.
- Confirmed from source that loading concurrently renders `Reading your answer…` and `{personaName} is replying…`.
- Environment note: the local review returned 404s for the regular and bold Overused Grotesk font URLs. The files live under `public/fonts`, while `app/globals.css` requests them from the public root. Correct that path before final visual/motion sign-off so measurements use the intended typeface.
- Not verified: a full authenticated submit/reply cycle, 10%-speed motion inspection, mobile interaction, and assistive-technology behavior. These belong to Phase 5 because discovery did not create or mutate application-session data.

Verdict: **Needs changes**. The four findings above are actionable; full motion and accessibility validation remains outstanding.
