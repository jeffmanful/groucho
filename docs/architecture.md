# Architecture and runtime map

Current implementation, reviewed 2 November 2026. Configuration and persisted session metadata select the runtime; a brand name or persona prompt alone does not.

## The flows

| Flow | Selection | Conversation result | What follows |
| --- | --- | --- | --- |
| Public persona demos | Gatekeeper project, `conversation_engine: conversation_v1`, registered profile | `completed`, explicit simulation completion | Named details and restart; no assessment/decision/fulfilment jobs |
| Newer COLORS applications | `conversation_engine: colors_forum`; protected COLORS demo selects the adapter explicitly | `completed`, neutral applicant closing | Real applications queue assessment/profile/suitability and configured decision/webhook processing; reviewer demos skip automatic jobs |
| Standard gatekeeper | Gatekeeper without a newer-engine setting, or a compatible historical session | `passed`, `redirected`, `rejected` are advisory outcomes | Configured completion/profile processing and independent client decision policy |
| Onboarding | `project_type: onboarding`, configured steps | `passed` after the configured flow | Optional LLM/extraction work only when configured; not a suitability verdict |
| Ticket-access sandbox | `project_type: ticket_access` | Synthetic operator activity | Test/dry-run simulation, not a ticketing integration |

The newer public/COLORS paths share `lib/conversation-engine.ts`. COLORS uses its compatibility adapter; demos add individual backend profiles and active database personas. Existing standard gatekeeper and onboarding code remains supported for those flows. Do not use legacy score/terminal prompts as templates for new public demos.

## Boundaries

1. **Conversation:** persist applicant identity, answers, interactions and neutral closing. Per-turn scores on the newer runtime are neutral compatibility placeholders.
2. **Assessment:** for real COLORS applications, generate a private evidence-backed report and grounded profile, then derive suitability. Public simulations do not run this stage.
3. **Decision:** a reviewer or an independently enabled deterministic client policy records approval/decline. Model recommendation and confidence are advisory, not access authority.
4. **Allocation:** projects using cohorts place approved applicants into a group. An access-granting cohort controls entitlement for those projects.
5. **Fulfilment:** the client product owns accounts, invitations, outcome messages, bookings and real inventory. A Groucho approval or demo ending does not itself perform them.

See [decision policy](client-decision-policy.md) and [review/allocation](client-decision-workspace.md).

## Entry points and trust

- Browser apps call a same-origin host relay using a conversations-scoped project key kept on the server.
- `/v1/sessions/{id}/start`, `/messages` and session reads resolve organisation/project from that key. These paths are not a universal authorisation system for arbitrary host users; the host must enforce ownership where needed.
- Applications keys are for authenticated server review integrations, never browser relays.
- Admin APIs enforce platform/organisation roles. Protected COLORS demo cookies are not reviewer permissions.
- `lib/colors-engine-routing.ts` and `lib/start-gatekeeper-session.ts` implement routing. Configured public demos never silently fall back to standard; old/incompatible sessions need restart.

## Configuration authority

| Concern | Source |
| --- | --- |
| Engine/profile | Project settings and opening metadata |
| Public demo voice/facts/options | Active accessible persona plus `lib/demo-conversation-profiles.ts` |
| COLORS voice/product context | COLORS code prompt and membership brief |
| Models | `lib/gatekeeper-models.ts` and relevant server overrides |
| Decision thresholds/switches | Project `decision_policy` |
| Database constraints/access | Ordered `supabase/migrations` plus server role checks |
| Browser response rendering | SDK version actually installed, or the demos' custom controller |

Use [database setup](database-setup.md), [integration](client-integration-guide.md) and [persona creation](demo-persona-creation.md) for implementation. Proposals and historical test results do not override these sources. Repository code, a deployed application, an applied migration and a published SDK release are separate states; verify each intended environment before launch.
