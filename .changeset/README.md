# SDK changesets and releases

This repository uses Changesets for `@groucho-gatekeeper/sdk`. A backend deployment does not publish the package or upgrade a host application.

1. For a package-facing change, add a changeset with the intended semver impact and concrete consumer behaviour. Preserve existing pending changesets until the release workflow consumes them.
2. Run `pnpm run sdk:build` and `pnpm run sdk:test`; code generation reads `docs/api/openapi.yaml`.
3. The release workflow in `.github/workflows/release.yml` prepares/publishes version changes according to its configured credentials and approvals. Verify workflow/package results instead of assuming a commit is a publication.
4. Consumers must adopt the compatible version and verify their own host. In particular, newer engine `completed` handling and relay exports may be absent from an older installed release.

See the [SDK source/adoption guide](../docs/sdk-surface.md), [package README](../packages/sdk/README.md) and [documentation maintenance](../docs/documentation-policy.md). Never put registry or project credentials in release notes.
