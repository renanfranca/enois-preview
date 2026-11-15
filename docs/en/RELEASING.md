# Releases and CI

[Português do Brasil](../pt-BR/RELEASING.md) · [README](README.md)

This guide is for enois-preview maintainers. Operators only need `npm install -g enois-preview`.

## Version

`package.json` and `package-lock.json` always stay at `0.0.0-SNAPSHOT`. `v<version>` tags are the only source of released versions, and a release never commits anything back to the repository. semantic-release calculates the version from Conventional Commits since the latest `v*` tag on `main`:

| Commits since the latest tag                                     | Release |
| ---------------------------------------------------------------- | ------- |
| `fix`, `perf` or `revert`                                        | patch   |
| `feat`                                                           | minor   |
| `!` in the header or a `BREAKING CHANGE:` footer                 | major   |
| only `docs`, `chore`, `test`, `ci`, `refactor`, `style`, `build` | none    |

No rule keeps the project below `1.0.0`. Example: after `v0.5.0`, a `fix: ...` and a `feat(setup): ...` produce `v0.6.0`.

Every commit must follow [Conventional Commits](https://www.conventionalcommits.org/); CI runs `commitlint` over the push or pull request range. Header, body and footer length limits are disabled.

## CI

The `build` workflow (`.github/workflows/build.yml`) runs on push and pull request to `main` and on `workflow_dispatch`, with `contents: read`, in this order: `actionlint` with its sha256 checked, Node from the `.nvmrc` family and Java 25, `npm ci`, `npm run prettier:check`, `commitlint`, `npm run typecheck`, `npm test` with H2 2.5.252 downloaded from Maven Central and checked by sha256 (`ENOIS_H2_JAR`), `npm run test:release`, `npm run test:workflows` and `npm run test:package`. Integration suites (Docker, real images and applications) do not run in CI.

To check the workflows locally, run `./tests-ci/lint-workflows.sh`. The workflow policy (`npm run test:workflows`) requires actions pinned to a full commit SHA, explicit minimal permissions and `id-token: write` only in the `publish` and `recover` jobs of `release.yml`.

## Release

The `release` workflow (`.github/workflows/release.yml`) has three jobs, all restricted to `renanfranca/enois-preview`, in one concurrency group that never cancels a running release:

- **`qualify`** (`contents: read`, `actions: read`): checks that the candidate commit is the current `main` head, has a green push `build` and has no `v*` tag yet.
- **`publish`** (`contents: write`, `id-token: write`): checks again that the checkout is still `origin/main` and runs semantic-release, which sets the version only in the ephemeral checkout, runs `test:package` and `npm pack --dry-run`, publishes to npm with provenance (Trusted Publishing, no stored token), and creates the tag and the GitHub release with generated notes.
- **`recover`** (`contents: write`, `id-token: write`): completes a release that failed midway (below).

**Automatic:** every green push `build` on `main` triggers the release. Without a releasable commit, nothing is published.

**Manual:** in Actions, run `release` with `operation=release` from `main`, with `version` empty. When there are commits since the latest tag but none is releasable, a patch is published. On an already released head, `qualify` stops and points to `recover`.

**Recovery:** run `release` with `operation=recover` and `version=<x.y.z>`. The tag `v<x.y.z>` must exist. The job checks out that tag and publishes only what is missing: the npm package for that version, the GitHub release, or both. It never creates a tag or a new version.

**Bad release:** use `npm deprecate enois-preview@<version> "<reason>"` and release a `fix`. Do not use `npm unpublish`.

## First version and Trusted Publisher (once)

npm only accepts a Trusted Publisher on a package that already exists, and without it semantic-release stops before creating the tag. The first automatic run after the merge therefore fails without publishing anything, and the first version is released by hand:

1. With a green `build` on the `main` head, calculate the version from the table above (there are `feat` commits since `v0.4.0`, so `0.5.0`).
2. Create and push the tag on that commit: `git tag v0.5.0 <head-sha>` and `git push origin v0.5.0`.
3. In a clean checkout of the tag: `npm ci`, `npm version 0.5.0 --no-git-tag-version`, `npm run test:package`, `npm pack --dry-run` and `npm publish`, with 2FA. This version has no provenance, which only exists for a publication made by CI.
4. On npm, in the settings of the `enois-preview` package, add a GitHub Actions Trusted Publisher with repository `renanfranca/enois-preview` and workflow `release.yml`.
5. Run `release` with `operation=recover` and `version=0.5.0`: the package exists, so the job only creates the GitHub release.

From then on, every release is automatic, with provenance and no stored token.

## Compatibility rule

With automatic repinning, a tool upgrade changes the Worker that serves every scenario in the catalog, including scenarios whose images carry an older runtime. A release that changes the contract between the Worker and the runtime inside the image incompatibly must change `FORMAT` and be released with a breaking change commit. A Worker keeps serving every catalog entry of the `FORMAT` it accepts.

## Formatting and history

The repository follows Prettier (`npm run prettier:check`); the pre-commit hook formats changed files. The `style: format with prettier` commit is listed in `.git-blame-ignore-revs`; run `git config blame.ignoreRevsFile .git-blame-ignore-revs` so `git blame` skips it. The pull request that brought that commit must therefore be merged with a merge commit: squash or rebase change the SHA and invalidate the file. If that happens, update the file with the new SHA in a `chore:` commit.
