# Releasing zcode-cli

This document covers the maintainer-only workflows for synchronizing the
upstream runtime, building the release tarball, and publishing releases. End
users do not need any of this — see the [main README](../README.md) for
installation and usage. GitHub Releases are the only distribution channel: the
package is named `zcode-cli` and nothing is published to npm.

## Remote extraction

The same path used by CI can be run locally:

```bash
brew install sevenzip
bun run sync -- --platform linux --arch x64
```

Use the committed artifact instead of the latest updater manifest when
rebuilding a reviewed release:

```bash
bun run sync:locked
```

The synchronization command:

1. reads the public stable-channel manifest used by ZCode Desktop, with the
   static CDN manifest as a fallback only when the service response is
   unavailable or invalid;
2. downloads the matching installer;
3. verifies its SHA-512 from the manifest;
4. extracts `resources/glm`;
5. builds and injects the local `@zcode/tui` adapter;
6. validates the official CLI version;
7. records provenance in `vendor/extraction.json`;
8. records the remote artifact URL and SHA-512 in
   `zcode-runtime.lock.json`;
9. aligns the package version prefix with the ZCode App version while
   preserving the independently incremented CLI build revision.

## Package contents

The distributed package is controlled by the `files` allowlist in
`package.json`. It contains only:

- `bin/zcode.js`, the bundled executable Node.js launcher;
- `vendor/`, the verified official `zcode.cjs` runtime, official bundled
  plugins and the compiled local `@zcode/tui` adapter;
- `config.example.json` and `zcode-runtime.lock.json`;
- `README.md`, `LICENSE` and the required `package.json`.

Tests, GitHub workflows, build scripts, launcher/TUI TypeScript sources, local
config, `.release/` artifacts and development `node_modules` are not packaged.
Installation pulls only the declared pi-tui runtime dependency. The launcher
and TUI are compiled to JavaScript with `tsdown`; its launcher banner adds the
Node.js shebang directly, with no post-build rewrite. The compiled TUI is
injected into
`vendor/` before publication.

## Versioning

Package versions use `<app-version>-<build>`, for example `3.3.5-2`. The prefix
tracks the upstream ZCode App. The globally increasing build revision tracks
fixes and features in this project. Do not use `3.3.5+build.2`: SemVer ignores
`+build` metadata when comparing upgrades.

Increment the project revision before publishing a local fix or feature:

```bash
bun run version:build
```

The release workflows normally perform that increment for you. The command is
also available for local inspection and exceptional manual preparation.

## Release flow

Publishing is split into two workflows so the committed version, the tarball,
the Git tag and the GitHub Release all describe the same release:

1. `.github/workflows/prepare-release.yml` extracts and validates the current
   official runtime, then opens or updates a Release PR containing the exact
   `package.json` version and `zcode-runtime.lock.json` build input;
2. a maintainer reviews and merges that PR;
3. `.github/workflows/publish.yml` checks out its merge commit, rebuilds the
   exact locked runtime, audits and install-tests the tarball, then creates
   `v<version>` and the corresponding GitHub Release with the tarball asset.

The generated `vendor/` directory remains ignored by Git and is rebuilt in both
workflows. Its updater URL and SHA-512 are committed in
`zcode-runtime.lock.json`. Preparation resolves the latest manifest; publishing
downloads the committed URL and verifies the locked SHA-512, so a later upstream
update cannot silently change a reviewed release.

The scheduled workflow follows the Desktop stable channel (`channel=1`) without
credentials or a personal `device_mid`. Static `latest-*.yml` files can lag the
service and are therefore recovery inputs, not the primary update signal. If
upstream rolls its stable channel back, synchronization keeps a newer committed
lock instead of silently downgrading it; adopting a rollback requires an
explicit maintainer review of `zcode-runtime.lock.json`.

The preparation workflow checks upstream once per day at 01:30 in the
`Asia/Shanghai` timezone, in `upstream` mode. [GitHub documents scheduled
triggers as best effort](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule):
under high Actions load a scheduled event can still be delayed or dropped. The
preparation itself is idempotent:
the fixed release branch is created or updated only when the runtime lock or
package version changes. A same-version upstream repack increments the global
build so the GitHub Release still carries an immutable new version. From the
Actions page, run **Prepare ZCode CLI release** with one of these modes:

- `cli` increments the global build and also aligns with the latest App;
- `upstream` checks for an App update without incrementing the build.

The modes use `release/zcode-cli` and `release/zcode-upstream` respectively. If
both PRs are open, merge one and rerun the other preparation mode so its version
is recalculated from the new `main` branch.

The workflow also runs a least-privilege keepalive job on scheduled events. It
calls [GitHub's workflow-enable API](https://docs.github.com/en/rest/actions/workflows#enable-a-workflow)
instead of creating dummy commits, which prevents the public-repository 60-day
inactivity rule from disabling this schedule. This cannot eliminate
platform-wide outages or dropped events; for a hard delivery deadline, use an
external scheduler or run the workflow manually:

```bash
gh workflow run prepare-release.yml --ref main -f kind=upstream
gh workflow enable prepare-release.yml
```

Merging either Release PR publishes automatically. **Publish ZCode CLI
release** can also be started manually for recovery. Its `publish` checkbox can
be disabled to run all validation and consistency checks without changing Git
tags or GitHub Releases. Tag creation and GitHub Release creation are
independently idempotent, so a partially completed run can be retried safely.

## Local release build

Local packaging uses the same commands as the publishing workflow. Start from
the exact clean commit whose version will be published:

```bash
bun install --frozen-lockfile
bun run release:build
git diff --exit-code -- package.json zcode-runtime.lock.json
bun run release:pack
```

`release:build` runs TypeScript checking and all tests, downloads the artifact
from `zcode-runtime.lock.json`, verifies its SHA-512, builds and injects the TUI,
then runs runtime and PTY smoke tests. `release:pack` runs the offline
`prepack` guard, creates `.release/zcode-cli-<version>.tgz`, audits every
included path and executable mode, installs it into a temporary directory, and
runs the installed `zcode --version`. Its final size, integrity and file count
are written to `.release/release.json`.

Publishing is tag + GitHub Release only (for example via the `/release` skill:
annotated `v<version>` tag, `git push origin <tag>`, `gh release create` with
the `.release/zcode-cli-<version>.tgz` asset); nothing reaches npm. Delete the
uploaded tarball afterwards — it is the audited preview and install-test
artifact and remains archived on the Release.

The README install URLs use
`releases/latest/download/zcode-cli-<version>.tgz`, whose asset name must
match the currently published latest Release exactly. After publishing a new
version, update the three READMEs' install URLs to the new asset name in the
next change (the URL is only downloadable once that Release exists).

Synchronization preserves the build when the upstream App version changes. For
example, syncing `3.3.5-12` against ZCode App `3.4.0` produces `3.4.0-12`.

Before enabling publication:

1. confirm redistribution rights for the extracted ZCode runtime;
2. under the GitHub repository's **Settings** → **Actions** → **General**,
   enable **Allow GitHub Actions to create and approve pull requests**;
3. prepare a `cli` release and merge its Release PR to verify a tag + GitHub
   Release publication with the tarball asset.

The publisher runs on a GitHub-hosted runner with Node 24. It refuses to reuse
a tag that points at another commit and attaches the tarball asset to an
existing Release when one is already present.
