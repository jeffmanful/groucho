# Groucho

Monorepo for the Groucho gatekeeper platform (Next.js) and the published [`@groucho-gatekeeper/sdk`](packages/sdk) package.

## Development

Use **Node.js 22.13+** at the repo root (required by **pnpm 11**; CI uses the same major version).

Install dependencies from the repository root using [pnpm](https://pnpm.io/) (version pinned in [`package.json`](package.json) via `packageManager`):

```bash
pnpm install
```

Run the platform app:

```bash
pnpm dev
```

Build or test the SDK:

```bash
pnpm run sdk:build
pnpm run sdk:test
```

Run the Next.js example consumer (port **3001**):

```bash
pnpm run example:groucho
```

## Docs and releases

Start with the [current runtime map](docs/architecture.md) and [documentation index](docs/README.md). Historical reviews are archived; obsolete build prompts and overlapping specifications were removed.

- Shared COLORS/public demo engine and migration rationale: [`docs/reusable-conversation-engine.md`](docs/reusable-conversation-engine.md)
- Creating a persona and wiring a future demo: [`docs/demo-persona-creation.md`](docs/demo-persona-creation.md)
- Proposed pilots: [`pilots/README.md`](pilots/README.md)
- Client-owned suitability thresholds and automatic actions: [`docs/client-decision-policy.md`](docs/client-decision-policy.md)
- Historical evidence and superseded-document map: [archive](docs/archive/README.md).
- Documentation index: [`docs/README.md`](docs/README.md)
- Publishing `@groucho-gatekeeper/sdk`: [Changesets](https://github.com/changesets/changesets) — merge version PRs from `.github/workflows/release.yml`; configure the `NPM_TOKEN` repository secret for npm publishes.
