# Changelog — 17 August 2026

## Conversation depth

- Documented how Groucho responds to thin, usable, rich, and concerning answers while preserving the COLORS persona.
- Added private answer-quality evidence and constrained moves: clarify, open a door, advance, follow a rabbit hole, challenge, or decide.
- Added deterministic guardrails so vague answers can receive another route in, rich answers can unlock a specialist question, and follow-ups stay bounded.
- Extended compact application state and the structured response contract with conversation-depth context.
- Added a neutral applicant-facing closing message while preserving the internal terminal reply for review.
- Updated the COLORS persona and application-improvement notes.
- Added and updated unit and contract tests for answer quality, state, prompts, structured responses, and terminal flow.
- Reframed configured application questions as private evidence goals with adaptable prompt routes.
- Allowed one answer to cover multiple goals and persisted attempted versus covered goals separately.
- Removed mandatory list-order advancement; Groucho can choose any unresolved goal that follows naturally from the current answer.
- Kept the configured order only as a gap-filling fallback and expanded rich-thread exploration within the existing two-point budget.

## Project cultural memory

- Added the five-phase plan in `docs/colors-cultural-signals.md`.
- Added an opt-in, project-scoped contract with a curated taxonomy.
- Added conservative normalisation, confidence filtering, de-duplication, fixed broad labels, and a maximum of eight signals per answer.
- Extended Groucho's private structured output so extraction never appears in applicant-facing replies.
- Restricted persistence to completed, non-bot sessions; local test sessions are excluded.
- Added source-linked events so deleting a source message, session, project, or organisation cascades to derived events and invalidates stored snapshots.
- Added 90-day, versioned snapshots based on distinct sessions.
- Added visibility thresholds of 5 sessions for normal signals and 10 for sensitive categories.
- Added a review queue; emerging themes remain excluded until a COLORS administrator approves them.
- Added an internal project dashboard for aggregate bands and trends, opt-in, and rebuilds. It exposes no responses, quotes, applicants, or source conversations.
- Added organisation-scoped admin endpoints and database access controls.
- Locked conversation use off. Memory does not affect Groucho's questions, scores, or decisions.

## Database

- Added `20260817200403_add_project_cultural_signals.sql` for events, definitions, snapshots, dirty-state tracking, indexes, cascades, triggers, row-level security, and service-role-only access.

## Verification

- Added coverage for opt-in defaults, thresholds, distinct-session counting, sensitive categories, emerging-theme approval, and aggregate output.
- Ran type checking, focused and full tests, lint, diff checks, and a successful production build. Supabase database lint was attempted but the local Postgres service was not available.
