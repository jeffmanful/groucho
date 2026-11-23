# Creating a project

Current guide, reviewed 23 November 2026. Source: `components/admin/ConversationProjectWizard.tsx`, `lib/project-conversation-config.ts` and `lib/project-settings.ts`.

Organisation owners/admins and platform administrators can create a conversation at `/admin/organisations/[orgId]/projects/new`. No backend profile registration or separate persona editor is needed.

## Configure and try a conversation

The default wizard has five steps:

1. **Purpose & context:** project name/slug, conversation objective and a separate approved project context. Context supplies facts the host may use to answer questions; the objective describes what the conversation should accomplish.
2. **Persona:** the host's name, personality, voice and boundaries. The persona belongs to this project; editing it does not change a shared library persona.
3. **Conversation flow:** opening message, an explicit opening question independent of signals, progression guidance, a hard limit of 1–12 applicant answers, closing guidance and a final closing statement. New projects start with “What brings you here?” as an editable opening question. Leaving it blank retains the fallback to the first signal, or the general question when there are no signals. Flow guidance describes how to move through the conversation without forcing a script. The opening answer and follow-ups count towards the ceiling; it is not a minimum. Stopping and the ceiling take precedence over any unfinished steps or final questions. Closing guidance shapes the brief acknowledgement; the server appends the configured final statement (or its default thank-you). The final statement cannot contain a question.
4. **Signals & examples:** up to twelve signals. Each has a name, what the client wants to understand, an optional guide to informative evidence and up to six example answers. Signals guide what to listen for rather than setting conversation order. Examples illustrate possibilities rather than eligibility requirements; include contrasting experiences such as informal care or online communities. Exact questions and answer formats remain optional controls within each signal. Choice formats require 2–12 distinct options. A signal's answer buttons appear at the opening only if its question matches the project opening question.
5. **Test & save:** review the objective, opening, flow, closing and signals, then start a conversation with the exact current configuration. Assess the opening, useful follow-ups, corrections and ending alongside the evidence inspector. Answer by text or buttons; inspect signal states, applicant quotes linked to answer numbers and explanations of relevance, then restart. Preview uses the same prompt, model, option catalogue, validators and completion behaviour as the saved flow. Start a preview before saving. Any configuration edit makes the previous preview stale and requires a restart before saving.

The host follows the purpose and signals naturally, accepting information out of order and avoiding repeated questions. An empty signal list allows an open conversation guided by intent. There is no required minimum number of questions. Refusing further conversation ends the exchange without another question; a declined topic can be left unknown when the applicant explicitly continues elsewhere. A conversation ending is not an approval, booking or external delivery.

The wizard saves `project_type: gatekeeper`, `conversation_engine: conversation_v1`, `conversation_profile: project` and a version-2 `project_conversation` document. These flows use the shared `postConversation` runtime. The configuration contains its own persona rather than requiring `persona_id`. Existing project integrations and unrelated settings survive edits. New projects start in test/dry-run mode.

Open the project's existing edit page to reconfigure and preview it. Changing the configuration produces a new SHA-256 runtime profile ID; old sessions receive a restart response, preventing mixed configurations within a conversation. Saving invalidates the runtime settings cache. Deploying a model/environment change can still affect subsequent replies; previews do not promise deterministic prose.

## Preview isolation

Preview transcripts are held in a signed token in the browser, bound to the authenticated actor and organisation and expiring after one hour. Each request rechecks organisation admin access, origin and rate limits. Signing uses `GROUCHO_PREVIEW_SIGNING_KEY` when provided, otherwise the existing server-only `SUPABASE_SERVICE_KEY`; no new environment variable is required for an already configured server. Neither secret is sent to the browser.

Preview execution does not read or write application sessions/messages and never queues completion jobs or webhooks. Model usage is logged without a database session association. Use synthetic information for tests. A temporary request failure keeps the last valid token and draft answer so the visitor can retry. Reloading the page discards the preview.

Saved custom conversations persist their sessions/messages through the normal project API. They return `signalEvidence` for every configured signal and `completion.mode: conversation` and `reviewStatus: not_required`; `complete: false` honestly reports priority signals that remain partial or unknown; it is not a rejection. A declined signal is a settled choice not to disclose. They do not run the application scoring/decision/report/webhook pipeline. Configure a separate integration before promising a booking, submission, email or downstream action.

## Existing project types

The alternate setup link retains the existing four-step wizard for legacy Gatekeeper, guided Onboarding and synthetic Ticket access projects. Existing projects remain on their configured engine.

| Type | Configure |
| --- | --- |
| Legacy `gatekeeper` | Accessible library persona, application experience and independent decision policy |
| `onboarding` | Project-owned ordered `flow_config.steps`, tone and optional LLM/extraction toggles |
| `ticket_access` | Isolated test/dry-run operator simulation; not live inventory or a ticketing provider |

Authored public demos remain supported. Their registered code profiles, branded websites and persona resolution are separate from client-created project profiles; see [demo persona creation](demo-persona-creation.md).

Issue a conversations-scoped key for applicant relays and a separate applications key only for authorised server review. Keep secrets server-side. See [projects](projects.md), [shared engine](reusable-conversation-engine.md) and [decision policy](client-decision-policy.md).

## Signal evidence and older configurations

The four signal states are **Evidence found**, **Partly understood**, **Not explored** and **Declined to share**. Evidence found means an informative account was supplied, not that attendance, identity or suitability was verified. Unexplored evidence stays unknown; it does not establish a missing personal quality.

Updates require registered signal IDs, applicant attribution and exact quotes from the current answer. Quotes link to one-based applicant answer numbers. Corrections replace superseded interpretations and sources. The runtime validates attribution labels and quote presence, not the semantic truth of an interpretation; complete-conversation review remains necessary. Signal conversations make a separate evidence review at closing so a short goodbye does not discard new context or a correction in the final applicant answer. This adds one model round trip at closing; a failure leaves the turn retryable rather than persisting an incomplete update. Example answers are never treated as applicant testimony or approved venue/event facts.

Version-1 question configurations remain supported unchanged by the runtime. Opening an older project in the wizard converts its questions into editable signal drafts, preserving wording, input types, options, priority and the old opening override. Saving and previewing that draft explicitly adopts version 2 and changes its configuration hash. Existing version-2 projects may omit `projectContext`, `conversationGuidance`, `closingGuidance` and `closingMessage`; omission preserves their stored revision and existing defaults. The wizard presents the effective opening question as an editable field, preserving the existing opening when the draft is saved. New optional controls are validated, signed into previews and included in the configuration revision. Canonical validation makes equivalent settings independent of JSON property order. No database migration is required.

In preview, only the latest assistant entry retains the accumulated evidence snapshot; signed transcripts keep source answer numbers stable without repeating large evidence maps at every turn. Saved sessions retain the evidence in message metadata, and the shared API and generated SDK expose `signalEvidence`.
