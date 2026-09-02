# Releasing

Users install `@simonklee/opentui-tex`. Each release publishes ten npm packages:
the JavaScript package, eight optional native packages, and the corresponding
native source package. All ten have the same version.

The native packages use the same target matrix and Bun/Node library-path exports
as OpenTUI. npm and Bun select a binary through `os`, `cpu`, and Linux `libc`
constraints. The JavaScript package keeps `@opentui/core` external and declares
it as a required peer. React and Solid are optional peers.

## First publication

npm requires a package to exist before you can configure its trusted publisher.
Publish all ten packages locally with an interactive npm login and two-factor
authentication first. Do not create an `NPM_TOKEN` secret.

1. Commit and push the release changes to `main`.
2. Create and push the matching `v0.2.0` tag. Do not publish the GitHub release yet.
3. Run `Release` manually with `tag` set to `v0.2.0` and `dry-run` enabled.
4. After the run succeeds, download its `npm-packages` artifact into a clean
   `release/` directory. Keep only the ten tarballs from that run.
5. From the repository root at the tagged commit, run:

```sh
npm login
RELEASE_TAG=v0.2.0 bun run publish:packages
```

Complete npm's browser or terminal authentication prompts. The publisher uses
your local npm login and publishes the tested tarballs in dependency order. If
the process stops partway through, rerun the same command without rebuilding.
The publisher checks npm before skipping an already-published version.

You can instead build and test the tarballs locally with `bun run release:check`
at the tagged commit before running these publication commands.

After the packages exist, configure a trusted publisher for **each of the ten
packages**. With npm 11.19.0, the command for the main package is:

```sh
npm trust github @simonklee/opentui-tex \
  --repo simonklee/opentui-tex \
  --file release.yml \
  --env npm \
  --allow-publish
```

Repeat it for `@simonklee/opentui-tex-native-source` and each of the eight names
in `package.json`'s `optionalDependencies`, with the same options. The npm
website offers the same fields under **Settings > Trusted Publisher**:

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `simonklee` |
| Repository | `opentui-tex` |
| Workflow filename | `release.yml` |
| Environment | `npm` |
| Allowed action | `npm publish` |

Create the GitHub environment `npm` in `simonklee/opentui-tex` and restrict it to
tags named `v*`. You can also require approval before publication. Only the
publish job uses this environment and receives `id-token: write`; build and
dry-run jobs need neither. No npm token secret is needed.

Later releases use OIDC authentication and receive npm provenance automatically
from this public repository. After a successful trusted release, select
**Require two-factor authentication and disallow tokens** in each package's
publishing settings. Local interactive publication remains available.

See [npm's trusted publishing guide](https://docs.npmjs.com/trusted-publishers/)
and [`npm trust`](https://docs.npmjs.com/cli/v11/commands/npm-trust) for the
account-side settings. Repository files alone cannot grant npm access.

## Validate a release

Use Bun 1.3.14, Zig 0.16.0, Node 26.4 or newer, npm 11.19.0 or newer, `curl`, and
`tar`. Run:

```sh
bun install --frozen-lockfile
bun run release:check
```

The check runs type checking, JavaScript and Zig tests, all native builds, and
package builds. It writes ten tarballs to `release/`. A local scoped registry
serves those tarballs to clean npm and Bun installs. The smoke tests verify
platform selection, Unicode output, native rendering, and shared OpenTUI class
identity on both Bun and Node. They also check that imports still work without
the TeX binary. The publisher then validates the tarballs and prints the publish
order without uploading packages.

The release runner tests native execution on Linux x64. Cross-compilation does
not establish runtime coverage on the other seven targets.

## Publish

Version 0.2.0 is the first single-install release. It replaces the separate
native JavaScript package from the 0.1.0 GitHub release. Keep the existing 0.1.0
tags and tarballs unchanged.

For later versions, update the root version and all native dependency versions
together:

```sh
npm version 0.2.1 --no-git-tag-version
```

The `version` script also updates `bun.lock`. Commit the version change and the
release code, then create and push the matching `v<version>` tag. Publish a
GitHub release for that tag to run the workflow. The tag must match
`package.json` exactly.

You can also run `Release` manually. Leave `dry-run` enabled to validate a branch
or tag without publishing. To publish manually, supply the existing release tag
and disable `dry-run`. Select that tag as the workflow ref too, so the run can
deploy to the tag-restricted `npm` environment.

The workflow publishes the tested tarballs, not rebuilt copies. It publishes
corresponding source first, native packages next, and the JavaScript package
last. Stable versions use the npm `latest` tag; prereleases use `next`.
Publication is not atomic. If publication stops partway through, rerun the failed
publish job to reuse the tarballs from the successful build job. The publisher
checks npm before skipping an already-published version.

Do not use plain `npm publish` from the repository root for a release: that
would omit the native packages. The coordinated command is
`RELEASE_TAG=v<version> bun run publish:packages`, after
`bun run release:check` succeeds. The named tag must point to `HEAD`.
