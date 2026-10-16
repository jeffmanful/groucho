# Dashboard experience with UIArc

Implemented 16 October 2026. UIArc is used through its official free component
registry; no Pro block source is reconstructed.

## Purpose and scope

Job: help operators find a project, open a conversation and review ticket
registrations without deciphering a dense settings screen.

Primary overview action: create a project, visible only when the existing
organisation permissions allow it.

Regions: workspace navigation, metric cards, searchable/sortable projects,
ticket-pilot entry and recent conversations. The ticket workspace uses the same
tokens and components for evidence, review and allocation.

The shared admin shell, overview and ticket-access screens are redesigned. Existing
organisation, session, persona and wizard detail pages retain their workflows
inside the new shell. These legacy pages remain dark; light mode is currently
available on the overview and ticket workspace only.

## Components and installation

The Arc MCP connection supplied the skill, component selection guidance and
documented props. Free components were installed through the shadcn CLI:

- `metric-card` and its `animated-counter` dependency;
- `sortable-data-table`;
- `search-field`;
- `badge`;
- `tabs`;
- `button`;
- `skeleton`;
- `arc-foundation`, with shared semantic tokens and motion presets.

Registry: <https://uiarc.dev/r/{name}.json>. `components.json` also registers the
`@uiarc` namespace for future installs. The components are checked into
`components/arc`. Foundation CSS is imported once in the root layout, with dark,
neutral defaults. Geist is already local; the body stack uses the documented
system fallback when Inter is not installed. Admin-level token overrides tune the
control/panel radii without changing installed component internals.

The dependency installation adds `lucide-react` and `@radix-ui/react-tabs`; existing
Motion is reused. Versions are recorded in the pnpm lockfile. The workspace-root
installer exception was temporary and is not retained in pnpm configuration.

## Behaviour

- The shell and overview share one cancellable overview fetch. Route navigation
  refreshes it; retries are inline. No API response schema or permission rule changed.
- The project table supports local search, organisation filtering and sorting.
  Ticket projects open their isolated demo workspace. Other project links preserve
  their organisation/project context. Configure links respect existing permissions.
- Metrics use actual overview counts. There are no invented charts, growth claims
  or approval rates. “Today” follows the existing API's day boundary.
- Conversation outcomes remain labelled as advisory; they are not final access
  decisions. Ticket eligibility remains separate from conversation suitability.
- Mobile navigation traps focus while open, closes on Escape and returns focus to
  its trigger. The background is inert while the mobile navigation is open.
- Arc provides keyboard table sorting, clearable search and peer-panel tabs. Its
  reduced-motion branches are retained. Theme changes are session UI preferences,
  not saved user settings.

The ticket model, provider simulations and once-only lottery rules are unchanged.
Every identity check and ticket handoff is still simulated, the conversation is
scripted and demo activity still resets on refresh. Read
[the rehearsal guide](../pilots/fi-demo-implementation.md) for those boundaries.

## Verification

- TypeScript and focused lint pass, including the installed Arc components.
- The 30 focused overview, project-settings, setup and ticket-model tests pass.
- Browser checks cover real-data overview loading, search/clear, a synthetic API
  outage and retry, an empty member workspace and permission-sensitive actions.
- The synthetic ticket registration, phone alternative, review, freeze and draw
  workflow passes with the new components. Arrow-key tabs and reduced motion are
  exercised.
- Layout checks at 390, 768, 1024 and 1440 pixels show no sideways page overflow.
  Tables retain their own horizontal scrolling where needed. Both light and dark
  themes and neutral/blue accent compatibility are checked; neutral remains the
  shipped accent.

This is not a full accessibility certification or a redesign of every legacy
admin form. Existing unrelated repository test/lint failures recorded in the
pilot implementation guide are outside this UI change.
