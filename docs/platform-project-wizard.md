# Creating a project

Current guide, reviewed 2 November 2026. Replaces the original implementation epic. Source: `app/admin/organisations/[orgId]/projects/new/page.tsx` and `lib/project-settings.ts`.

An organisation owner/admin or platform administrator creates a project inside the intended organisation. Choose identity/type, configure experience and persona/flow, review settings, then create/configure integrations. The standard wizard has four steps; ticket-access simulation uses its dedicated setup after type selection. UI labels can change without altering the permission/configuration contract.

| Type | Configure |
| --- | --- |
| `gatekeeper` | Active accessible persona, intended conversation engine, neutral applicant ending and independent decision policy |
| `onboarding` | Project-owned `flow_config.steps`, tone and optional LLM/extraction toggles |
| `ticket_access` | Isolated test/dry-run operator simulation; not live inventory or a ticketing provider |

The ordinary wizard does not register a new public-demo profile in code. For one, follow [demo persona creation](demo-persona-creation.md), deploy the registered backend profile, merge engine/profile settings without dropping unrelated keys, and wire the separate website.

Issue a conversations-scoped key for applicant relays and a separate applications key only for authorised server review. Keep secrets server-side. Configure signed webhooks only when the host is ready to receive and act on the relevant events. No API key, project or persona prompt grants a visitor approval automatically.

Before launch, verify the exact project/key/engine and a fresh complete conversation in the intended deployment. Keep both automatic actions off unless the client has deliberately enabled/calibrated them. See [projects](projects.md), [decision policy](client-decision-policy.md), [API-key ADR](adr/0001-api-key-and-client-access.md) and [COLORS invitation pilot](colors-admin-pilot.md).
