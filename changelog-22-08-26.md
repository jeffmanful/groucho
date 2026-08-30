# Changelog — 22 August 2026

## Admin profiles

- Diagnosed failed manual profile generation: completion jobs were healthy, but the extractor could receive model output that was not valid JSON.
- Switched profile extraction to Anthropic structured JSON output with a strict core schema and a safe schema derived from each persona's custom profile fields.
- Added explicit handling for model refusals and responses cut off by the token limit.
- Increased the profile response allowance to support fuller summaries and Q/A evidence.
- Added coverage for the structured output request and custom persona fields.
- Fixed the dashboard success message so first-time generation is not incorrectly described as regeneration.

## Admin session experience

- Replaced the Sessions tab's anonymous database query with authenticated, project-scoped admin API loading so accessible sessions are returned consistently.
- Added an organisation-aware project selector, automatic selection of the remembered/active project, manual refresh and project-specific empty/error states.
- Session transcripts now load on demand for the selected session, keeping the initial project load fast while preserving realtime updates when available.
- Rebuilt the live sessions page as a responsive master/detail workspace:
  - session browser on the left;
  - selected transcript in the centre;
  - status, applicant details, activity and latest signal scores on the right.
- Active sessions are visually distinct and selected first when there is no current selection.
- Added clearer selected states, live typing visibility, scrollable panels, improved control sizes and responsive two-/one-column fallbacks.
- Expanded the organisation dashboard to use the available desktop width.
- Changed the organisation's project sessions area to a side-by-side session list and transcript/profile view, with the active or newest session opened automatically.

## Verification

- Profile extraction unit tests: 13 passing.
- TypeScript check, lint, production build and full test suite passing.
- Live Anthropic extraction check returned a valid profile with `status: ok`.
