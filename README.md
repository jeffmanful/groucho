# Groucho

Monorepo for the Groucho gatekeeper platform (Next.js) and the published [`@groucho/sdk`](./packages/sdk) package.

## Development

Use **Node.js 22.13+** at the repo root (required by **pnpm 11**; CI uses the same major version).

Install dependencies from the repository root using [pnpm](https://pnpm.io/) (version pinned in [`package.json`](./package.json) via `packageManager`):

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

- Current COLORS state of play: [`docs/groucho-state-of-play-2026-08-20.md`](./docs/groucho-state-of-play-2026-08-20.md)
- Documentation index: [`docs/README.md`](./docs/README.md)
- Publishing `@groucho/sdk`: [Changesets](https://github.com/changesets/changesets) — merge version PRs from `.github/workflows/release.yml`; configure the `NPM_TOKEN` repository secret for npm publishes. 
