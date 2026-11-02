# Documentation maintenance

Reviewed 2 November 2026.

- `docs/README.md` indexes current guidance. Current guides name their runtime scope and link the implementation/configuration authority.
- Keep one operational owner for a topic. Persona voice, backend profile, shared engine and website presentation have separate responsibilities; do not duplicate prompts or contradictory setup recipes.
- `pilots` holds proposals and simulations. Mark what is implemented separately from intended functionality; a dated meeting plan is not a current launch instruction.
- `docs/archive` holds historical evidence only. Its observations, model versions, blockers and proposed remedies apply to the recorded run, not automatically to today's system.
- Remove obsolete build instructions and duplicated specifications once superseded. Keep the replacement/removal map in the archive index; Git history is the recovery source.
- Keep runtime-consumed schemas/replay fixtures at stable paths unless their readers are updated. Do not hand-edit generated SDK types; regenerate them from OpenAPI when changing the contract.
- When changing shared behaviour, update relevant guide/index, contracts and examples together. Keep the package name consistent with `packages/sdk/package.json`.
- Check relative links and anchors after moves. Validate JSON/YAML and SDK generation when contracts change. Documentation-only edits do not need live billable model runs.
- Distinguish implemented, locally tested, deployed, migrated and published. Do not carry forward stale “current blockers” or a fixed test count as today's guarantee.
- Use synthetic examples. Do not commit credentials, invitation tokens, real applicant transcripts or private contact details.

For this consolidation, see the [archive/removal map](archive/README.md). The frontend repository independently maintains its browser contract and new-demo checklist.
