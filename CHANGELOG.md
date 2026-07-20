# Changelog

All notable product and platform changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and released versions
will follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-07-20

### Added

- Added configurable gatekeeper application experiences with opening and closing
  messages, opening interaction controls, ordered required signals, preferred
  input types, and a maximum-turn target.
- Added admin project fields and validation for configuring application
  experiences without editing prompts directly.
- Added structured gatekeeper interaction metadata for intent, input type,
  options, emotional state, visual state, accumulated scores, and the next
  application signal.
- Added compact application state tracking. Answers are stored against stable
  signal keys in message metadata and configured flows send this state instead
  of replaying the full transcript.
- Added `GatekeeperV2`, structured interaction inputs, decision-moment helpers,
  and dot-matrix presence components to the React SDK.
- Added applicant email capture to the default SDK and `/doorcheck` flows. The
  normalized email is persisted as `sessions.applicant_email` before the first
  application question so approved applicants can be invited later.
- Added focused contract and flow coverage for opening messages, interaction
  specifications, signal state, model selection, terminal decisions, applicant
  identity, and the COLORS application sequence.
- Added the COLORS application improvement tracker and V2 roadmap documentation.

### Changed

- Reframed Groucho V1 around gatekeeper applications. Onboarding remains a
  mostly static intake flow and does not use an LLM unless an intelligent
  onboarding feature is explicitly enabled.
- Replaced the COLORS application with a tighter six-question sequence covering
  intent, artist attention, recommendations, unfinished-work feedback,
  participation style, and a realistic first-month contribution.
- Updated the COLORS recommendation question and prompt guardrails so Groucho
  never asks who received or was sent a music recommendation.
- Moved ordinary gatekeeper conversation turns to pinned Claude Haiku 4.5, with
  a server-side model override for controlled evaluation.
- Moved accumulated signal assessment into the main structured conversational
  response and removed the parallel per-turn scoring request.
- Removed artist enrichment from the applicant response critical path.
- Reduced conversational output limits to suit the bounded, short-response flow.
- Made the structured terminal field authoritative while retaining legacy token
  normalization for older personas and sessions.
- Made every applicant-facing terminal path use the client-configured neutral
  closing message while keeping pass, redirect, and reject outcomes private for
  reviewers, webhooks, and admin views.
- Expanded the SDK and OpenAPI session-start contracts to support applicant
  identity, opening interactions, structured UI responses, and session bootstrap.
- Simplified the default applicant capture UI to request email only; hosts can
  still provide a known applicant name programmatically.

### Fixed

- Prevented gatekeeper application flows from ending with definitive copy such
  as acceptance, rejection, or immediate access language.
- Removed the obsolete post-pass `/doorcheck/access` redirect now that contact
  email is collected before the application and invitations happen after review.
- Ensured `/doorcheck` sends the same applicant email during bootstrap, normal
  turns, and concluded-session retries, and clears it when starting over.
- Removed the separate Supabase Realtime key override from `/doorcheck`, avoiding
  repeated failed broadcast and websocket reconnect requests when that key
  differs from the configured browser client key.
- Preserved legacy full-transcript behavior for sessions created before compact
  application signal metadata was available.

### Performance

- Reduced configured conversational turns to one model request by combining
  response generation and accumulated assessment.
- Reduced prompt input size by replacing repeated full-transcript fan-out with a
  bounded structured signal state.
- Removed artist-reference enrichment latency from the synchronous response path.
- Reserved larger-model final assessment as an evaluation option rather than a
  default dependency for every conversational turn.

### Documentation

- Updated the PRD, project configuration guide, persona guidance, database setup,
  OpenAPI contract, SDK guide, and implementation prompts to match the V1
  gatekeeper direction and neutral application lifecycle.
- Documented that applicants do not need accounts before applying: Groucho stores
  their application email first, and approved applicants receive account invites
  after review.
