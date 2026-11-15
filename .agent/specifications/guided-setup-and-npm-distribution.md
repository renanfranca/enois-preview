# Guided setup, npm distribution and continuous integration

## Status

- **Status:** approved, not implemented.
- **Source:** requirements agreed in conversation on 2026-11-14 and 2026-11-15, after the 0.4.0 release.
- **Base:** `main` at `7a3aef5`, tagged `v0.4.0`.
- **Target version:** the next minor version calculated by semantic-release from the `v0.4.0` tag (expected `0.5.0`).
- **Reference flow:** the release and CI flow of the maintainer's `seed4j-cli` project (semantic-release, Trusted Publishing, qualification before publication, recovery), without its experimental channel. It is a read-only reference for the ideas: this document states the whole contract, and the implementation MUST NOT copy files from that repository.
- **Compatibility:** none with 0.4.0. Configurations, journals and launchers created by 0.4.0 or earlier are not
  adopted, migrated or resumed. Operators create new infrastructure with the guided setup. Existing Workers and
  launchers are left untouched, so their links keep working while their owners keep them.

## Purpose

Today a new operator has to follow `docs/diagnostics/installation.*.md` by hand: install a pinned commit through
`install.sh`, generate a launcher with `scripts/prepare-launcher.js`, create a lockfile, create a private repository,
commit and push it, deploy a Worker, register five secrets in two platforms, edit `LAUNCH_ENABLED` and push again, and
repin `tool.lock.json` and `package.json` in the launcher for every tool release. `enois-preview setup` only verifies
infrastructure that already exists. Releases are cut by hand, with the version typed into `package.json`, and the
repository has no CI.

**Observable success:**

1. An operator with their own GitHub and Cloudflare accounts runs `npm install -g enois-preview` and
   `enois-preview setup`, confirms one plan, and reaches a working private infrastructure without cloning, editing,
   committing or pushing anything. The only unavoidable manual step is creating a fine-grained GitHub token in the
   browser, and the tool guides it.
2. Upgrading is `npm install -g enois-preview@latest`. The next `publish` moves the launcher to the running version by
   itself.
3. For the maintainer, every `feat` or `fix` commit that reaches `main` with a green build becomes an npm version and a
   GitHub release, with no version typed by hand.
4. Every push and pull request runs a CI job that finishes in about five minutes.

Each operator keeps their own infrastructure. Nothing in this specification introduces shared infrastructure.

## Terms

- **Infrastructure:** what one operator owns once: the private launcher repository and its publication branch, the
  GHCR package, the Cloudflare account and Worker, the Worker origin, and the secrets.
- **Workspace:** what one publication context owns: application repositories, local H2 database, H2 driver, accounts,
  media mappings, private state directory. An operator may have many workspaces.
- **Running version:** the `version` field of the `package.json` of the running tool.
- **Plan:** the list of infrastructure resources `setup` observed, each marked `exists`, `create` or `update`.

## 1. Version and release

### 1.1 Version source

- `package.json` and `package-lock.json` MUST stay at `0.0.0-SNAPSHOT` in source. Git tags `v<version>` are the only
  source of truth for released versions.
- The release MUST NOT commit anything back to the repository (no `@semantic-release/git`, no version bump commit).
- The tool MUST read its own version from its `package.json` at run time. A development checkout therefore reports
  `0.0.0-SNAPSHOT`.
- `enois-preview --version` MUST print the running version and exit 0.

### 1.2 Version calculation

semantic-release MUST calculate the version from Conventional Commits since the latest `v*` tag reachable from `main`,
with the `conventionalcommits` preset:

| Commits since the latest tag | Release |
| --- | --- |
| `fix`, `perf` or `revert` | patch |
| `feat` | minor |
| `!` in the header or a `BREAKING CHANGE:` footer | major |
| only `docs`, `chore`, `test`, `ci`, `refactor`, `style`, `build` | none |

There is no rule keeping the project below `1.0.0`. A manual release request on a `main` with commits since the latest
tag but no releasable commit MUST publish a patch, as in the reference flow.

### 1.3 Release workflow

A workflow `.github/workflows/release.yml` MUST provide:

- **Automatic release:** triggered by a successful `build` workflow run for a `push` to `main` from this repository.
- **Manual release:** `workflow_dispatch` with `operation=release`, run from `main`. The version input MUST stay empty;
  the version is always calculated.
- **Recovery:** `workflow_dispatch` with `operation=recover` and `version=<x.y.z>`. The tag `v<version>` MUST already
  exist. Recovery checks out that tag and publishes only what is missing: the npm package for that version, the GitHub
  release, or both. It MUST NOT create a tag or a new version.

Qualification and publication MUST be separate jobs:

- The **qualify** job runs trusted code from `main` with `contents: read` and `actions: read` only. It MUST confirm
  that the candidate SHA is the current `main` head and has a successful push `build` run, and that no `v*` tag already
  points to it (a manual release on an already released head MUST fail and point to `recover`).
- The **publish** job runs only when qualification passes, with `contents: write` and `id-token: write`. It MUST
  re-check that the checked-out SHA is still `origin/main` before running semantic-release.
- Every job MUST be guarded by `github.repository == 'renanfranca/enois-preview'`, so forks never publish.
- Release runs MUST share one concurrency group that never cancels a running release.
- Workflow-level `permissions` MUST be `{}`. Each job declares only what it needs.

Publication:

- npm publication MUST use Trusted Publishing (OIDC) with provenance (`NPM_CONFIG_PROVENANCE=true`). No npm token is
  stored in the repository secrets.
- Before publishing, the release MUST set the version only inside the ephemeral checkout
  (`npm version <version> --no-git-tag-version`), build, run the package content test and `npm pack --dry-run`.
- Release notes MUST be generated from the commits by semantic-release and published as the GitHub release
  `v<version>`. Release Drafter is not used.

### 1.4 Changelog

- `CHANGELOG.md` and `docs/en/CHANGELOG.md` MUST be frozen at 0.4.0. Each gets a note at the top, in its language,
  saying that later versions are documented in the GitHub releases, with the link.
- The frozen history MUST be kept unchanged below that note.
- Guides that describe the changelog policy MUST be updated accordingly.

## 2. Continuous integration

A workflow `.github/workflows/build.yml`, named `build`, MUST run on push and pull request to `main` and on
`workflow_dispatch`.

- Workflow permissions: `contents: read`. Checkout MUST NOT persist credentials (`persist-credentials: false`).
- Steps, in order:
  1. `actionlint` downloaded from its GitHub release at an exact version, with its sha256 checked before running.
  2. Node at the exact version selected by `.nvmrc` major 24, and Java 25 (Temurin).
  3. `npm ci`, then `npm run prettier:check` (section 2.2).
  4. `commitlint` over the pushed range (push) or the pull request range (pull request), with
     `@commitlint/config-conventional` and header, body and footer length limits disabled.
  5. `npm run typecheck`.
  6. The unit suite (`npm test`). The H2 driver 2.5.252 MUST be downloaded from Maven Central with its sha256 checked
     and passed to the tests through `ENOIS_H2_JAR`.
  7. Release policy tests and workflow policy tests (section 2.1).
  8. The package test (section 3.1).
- The integration suites (`test:example`, `test:image`, `test:capture`, `test:install`, `test:memory`, `test:startup`,
  `test:flows`, `test:media`, `test:layers`, `test:consumer`, `test:worker-upload`) MUST NOT run in CI. They need
  Docker, real images or real applications.
- **Time budget:** the job SHOULD finish in at most 5 minutes on `ubuntu-latest` and MUST declare
  `timeout-minutes: 15`. The implementation MUST record the measured duration. If the job exceeds 5 minutes, the
  implementation MUST stop and present options to the maintainer before removing or weakening any test.
  Reference measurement on the maintainer's 32-core machine at `7a3aef5`: build 3 s, 119 unit tests in 104 s, slowest
  test 21 s. A 4-core runner is expected to be slower; it was not measured.

### 2.1 Policy tests

- **Release policy:** version validation, qualification decisions (current head, green build, already released head,
  wrong event or branch, fork), recovery request validation, and the manual patch rule.
- **Workflow policy:** every third-party action is pinned to a full commit SHA (a version comment is allowed); every
  workflow and job declares explicit minimal permissions; only the publish and recover jobs hold `id-token: write`.

### 2.2 Code formatting

The formatting setup MUST come from the Seed4J CLI modules `init` and `prettier`, generated in an empty temporary
directory with `--project-path` and `--no-commit`, never applied to this repository: in this repository `init`
replaces `package.json`, `README.md` and `.gitignore` (measured on 2026-11-15 in a throwaway clone).

- Copied from the generated project, unchanged unless stated: `.editorconfig`, `.gitattributes`, `.npmrc`,
  `.prettierrc`, `.prettierignore`, `.lintstagedrc.cjs` and `.husky/pre-commit`.
- `.prettierignore` MUST additionally ignore `dist` and `docs/validation`.
- `.lintstagedrc.cjs` MUST also format `ts`, `js`, `cjs` and `mjs` files.
- `package.json` MUST keep all its current content and gain only the generated `devDependencies` (Prettier and its
  plugins, `husky`, `lint-staged`) and the scripts `prettier:check`, `prettier:format` and `prepare`, with exactly the
  versions the Seed4J CLI generated. The source is the Seed4J CLI from the npm `experimental` channel, at its latest
  version at implementation time, never another repository's files. On 2026-11-15, `0.6.0-experimental.8` generated
  `prettier` 3.9.10, `husky` 9.1.7 and `lint-staged` 17.6.0.
- `prepare` MUST NOT fail in CI, in `npm pack` or outside a Git checkout.
- `.seed4j/` history and the Seed4J agent skill MUST NOT be added to the repository.
- The whole repository MUST be formatted in one commit `style: format with prettier`, containing only formatting, and
  its SHA MUST be listed in `.git-blame-ignore-revs`. `npm run typecheck` and `npm test` MUST pass on that commit,
  because `prettier-plugin-organize-imports` reorders and removes imports. Measured on 2026-11-15: 146 files change,
  about 13,000 lines inserted and 6,500 removed.
- The formatting setup and the formatting commit MUST land before the other changes of this specification.

## 3. npm distribution

### 3.1 Package

- The package name is `enois-preview`, unscoped, public. `"private": true` MUST be removed.
- `.npmrc` MUST set `save-exact=true`.
- `prepack` MUST build `dist`.
- `wrangler` and `playwright` MUST move to `dependencies`, because the CLI runs them (`wrangler whoami`, deploy,
  Chromium decoding validation). `typescript`, `esbuild`, `miniflare` and the release tooling stay in
  `devDependencies`.
- `files` MUST be an allowlist containing exactly what the CLI and the launcher read at run time: compiled `dist`
  without `dist/test`, and the source directories the CLI inventories or copies into a frozen revision (`recipe`,
  `runtime`, `src`, `shared`, `example`), plus `README.md`, `LICENSE` and the operator guides in `docs/pt-BR` and
  `docs/en`. It MUST exclude `test/`, `dist/test/`, `docs/validation/`, `VALIDATION.md`, `.agent/` and `.github/`.
- A **package test** MUST run `npm pack`, install the tarball globally into a temporary prefix, run
  `enois-preview --version` and `enois-preview --help` from that prefix, and compare the packed file list with the
  allowlist. It MUST fail when a run-time file is missing or an excluded path is present.

### 3.2 Removals

These MUST be removed, with their tests and documentation:

- `install.sh` and `scripts/install-tool.ts`;
- the `enois-preview install` command;
- the `install.json` stamp, `verifiedCommit` and `preview/installation.ts` stamping;
- the `unverified-tool` warning;
- `scripts/prepare-launcher.ts` as a standalone script (its generation logic moves into `setup`);
- `tool.lock.json` in generated launchers.

### 3.3 Tool identity in revisions

- Journals and final results MUST record `toolVersion` (the running version) instead of `toolCommit` and
  `toolVerified`.
- `resume` of a journal without `toolVersion` MUST stop with
  `Revision <revision> was created by an earlier enois-preview version and cannot be resumed by this version. Run enois-preview publish <scenario> to create a new revision.`
- The revision identity MUST keep inventorying `recipe`, `runtime`, `src` and `dist` from the package root.
- The User-Agent of the validation session and of the interrupted upload helper MUST be `enois-preview/<running version>`,
  from a single shared constant.

## 4. Configuration

### 4.1 Split

- Infrastructure MUST be stored once per operator in `~/.config/enois-preview-ts/infrastructure.json`, mode `0600`,
  with `format: "enois-preview-ts-v1"` and the fields `repository`, `branch`, `registry`, `worker`, `origin` and
  `cloudflareAccountId`. The environment variable `ENOIS_PREVIEW_INFRASTRUCTURE` MAY override the path (tests use it).
- Workspace configuration stays in `<home>/config.json`. The home is still selected by `--home`, then
  `ENOIS_PREVIEW_HOME`, then `~/.config/enois-preview-ts`.
- `publish`, `resume` and `source-digest` MUST combine `infrastructure.json` with the workspace configuration.
- `infrastructure.json` MUST NOT contain secrets. Secret values live only in Cloudflare and GitHub, plus the pending
  file of section 5.6 while it exists.

### 4.2 Missing and unknown fields

- `publish`, `resume` and `source-digest` without `infrastructure.json` MUST stop with
  `Infrastructure missing. Run enois-preview setup first.` and create nothing.
- Any field of a workspace configuration that the workspace contract does not define, including infrastructure fields,
  MUST be ignored and reported once with the existing `ignored-config-fields` warning, which names the fields.

## 5. Guided setup

### 5.1 Interface

```
enois-preview setup [--config WORKSPACE_JSON] [--yes]
                    [--launcher OWNER/REPO] [--branch BRANCH] [--registry ghcr.io/OWNER/NAME]
                    [--worker NAME] [--account CLOUDFLARE_ACCOUNT_ID]
```

- Without `--config`, `setup` configures only the infrastructure.
- With `--config`, it also validates the workspace and stores it in `<home>/config.json`, as today.
- Defaults, where `<login>` is the authenticated GitHub login:
  - `--launcher`: `<login>/enois-preview-launcher`;
  - `--branch`: `main`;
  - `--registry`: `ghcr.io/<login>/enois-preview`;
  - `--worker`: `enois-preview-launcher`;
  - `--account`: the only account reported by `wrangler whoami`. With several accounts and no `--account`, setup MUST
    stop and list the account names and IDs. An `--account` that is not listed MUST stop setup.
- Values in an existing `infrastructure.json` take precedence over defaults. A flag that contradicts an existing
  `infrastructure.json` MUST stop setup with a message naming both values; changing infrastructure is out of scope.

### 5.2 Idempotence

Setup converges: it observes every resource, creates or updates only what is missing, and verifies the rest. Running it
again on a complete infrastructure MUST perform no remote write and MUST report every resource as `exists`.

### 5.3 Plan and consent

- Step 1 of 5.4 (tools and logins) runs before the plan, because resources cannot be observed without logins. Each
  login fix it offers asks its own confirmation, needs an interactive terminal, and is never implied by `--yes`.
  Without a terminal, a missing login stops setup with the command to run.
- After step 1 and before any other remote or local write, setup MUST print the plan on stderr: one line per resource
  with `exists`, `create` or `update`, naming the resource (repository, branch, Worker, origin, each secret by name,
  launcher format, Chromium, local files).
- When the plan contains `create` or `update`:
  - in an interactive terminal without `--yes`, setup MUST ask one confirmation; any answer other than yes ends with
    exit 1 and no writes;
  - with `--yes`, setup proceeds without asking;
  - without an interactive terminal and without `--yes`, setup MUST exit 1 after printing the plan, with
    `Setup needs to create or update infrastructure; rerun in an interactive terminal or with --yes.`, and MUST NOT
    write anything.
- Prompts that read a secret (section 5.6) still require an interactive terminal, even with `--yes`. Without one,
  setup MUST stop before any write and name the missing secret.

### 5.4 Steps

Setup MUST run these steps in this order. Each step verifies first and acts only on what is missing.

1. **Tools and logins.**
   - Required commands: `git`, `node`, `npm`, `java`, `javac`, `docker`, `gh`, `flock`, as today.
   - `gh` must be logged in with the scopes needed by the following steps. When scopes are missing, setup offers
     `gh auth refresh` with exactly those scopes.
   - Docker must be logged in to `ghcr.io`. When it is not, setup offers to log in with the `gh` token passed on stdin.
     The token MUST NOT appear in arguments, output or files.
   - `wrangler` must be logged in. When it is not, setup offers `wrangler login`.
   - After the plan is confirmed, setup installs Chromium for the public validation (`playwright install chromium`)
     when it is missing. A failure is the warning `browser-missing` with the retry command and does not stop setup.
2. **Launcher repository.**
   - Missing: setup creates it private, generates the launcher files (5.5), commits as `enois-preview` and pushes the
     publication branch.
   - Existing: it MUST be writable (gate), MUST have `main: "launcher.ts"` in `wrangler.jsonc` and matching
     `GITHUB_REPOSITORY` and `GITHUB_OWNER` (gate). A non-private repository is the warning `launcher-not-private`,
     as today.
   - An existing launcher in another format (for example a 0.4.0 launcher with a `codeload` dependency and
     `tool.lock.json`) MUST stop setup with a message telling the operator to choose a new `--launcher`. Setup never
     migrates it.
3. **Worker.** If the Worker does not exist, setup deploys the launcher with `LAUNCH_ENABLED=false` and records the
   origin `https://<worker>.<subdomain>.workers.dev`. If the account has no `workers.dev` subdomain, setup stops with
   instructions.
4. **Secrets** (5.6).
5. **Activation.** When every secret is present and `LAUNCH_ENABLED` is not `true`, setup sets it to `true`, commits,
   pushes and deploys.
6. **Registry.** Setup MUST NOT require the GHCR package to exist. The package is created by the first image push of
   `publish` (section 6.2).
7. **Local files.** Setup writes `infrastructure.json` and, with `--config`, the workspace `config.json`, under the
   existing installation lock. It keeps the `free-plan` warning.

### 5.5 Generated launcher format

- `package.json`: private, `type: module`, `engines.node` `>=24 <25`, `devDependencies` with `enois-preview` at the
  exact running version and `wrangler` at the exact version the tool depends on. No script compiles `enois-preview`.
- `package-lock.json` generated with `--ignore-scripts`.
- `launcher.ts`, `tsconfig.json`, `.gitignore`, `.nvmrc` and an empty `catalog/scenarios.json`, as generated today.
- `wrangler.jsonc` with the Worker name, `LAUNCH_ENABLED`, `GITHUB_REPOSITORY`, `GITHUB_OWNER`, the Durable Object
  binding and migration, and `observability.enabled: false`.
- No `tool.lock.json`.

When the running version is not published on npm (for example `0.0.0-SNAPSHOT`), creating or repinning a launcher
MUST stop with `enois-preview <version> is not published on npm; run setup from an installed release.`

### 5.6 Secrets

| Secret | Where | Source |
| --- | --- | --- |
| `GITHUB_TOKEN` | Worker secret | fine-grained token created by the operator |
| `CALLBACK_SECRET` | Worker secret | generated by setup |
| `DEMO_CALLBACK_SECRET` | Codespaces user secret, launcher repository only | same value as `CALLBACK_SECRET` |
| `DEMO_WORKER_URL` | Codespaces user secret, launcher repository only | the Worker origin |
| `REDE_SECURITY_ENCRYPTION_KEY` | Codespaces user secret, launcher repository only | generated: 32 random bytes, standard Base64 |

Rules:

- An existing secret MUST NOT be overwritten. Secret rotation is out of scope.
- When an existing Codespaces secret does not include the launcher repository in its selected repositories, setup MUST
  add the repository without changing the value. This is an `update` in the plan.
- `GITHUB_TOKEN`: setup prints the token creation URL and the exact permissions (resource owner and repository: the
  launcher only; Contents read, Codespaces read and write, Codespaces metadata read), reads the token from a hidden
  prompt, and MUST verify it by listing the launcher's Codespaces with it before storing it. A token that fails
  verification is not stored, and setup asks again or stops. Setup MUST NOT use the `gh` CLI token for this secret.
- `CALLBACK_SECRET` and `DEMO_CALLBACK_SECRET` must hold the same value, and neither can be read back. Therefore:
  - when both are missing, setup generates one value, writes it to
    `~/.config/enois-preview-ts/pending-callback-secret` with mode `0600`, writes the Worker secret, writes the
    Codespaces secret, then deletes the pending file;
  - when exactly one exists and the pending file exists, setup completes the missing side from the pending file, then
    deletes it;
  - when exactly one exists and there is no pending file, setup MUST stop, explain that the two sides can no longer be
    matched, and name the one secret the operator must delete before running setup again.
- Secret values MUST NOT appear in arguments, output, logs, journals or `infrastructure.json`. They are passed on stdin.

### 5.7 Output and failure

- On success, the final JSON MUST contain `status: "configured"`, the infrastructure fields of 4.1, `created` and
  `updated` (resource names), and `warnings`, as today.
- Gates in setup are: a missing required command; a failed login that the operator declines to fix; an unwritable or
  mismatched launcher; an unpublished running version when a launcher must be created or repinned; an unknown or
  ambiguous Cloudflare account; a launcher in another format; a flag contradicting `infrastructure.json`; a secret that cannot be stored or verified;
  the one-sided callback secret without a pending file; a declined or impossible confirmation.
- Everything else observed MUST be a warning, following the 0.4.0 principle.
- Interruption (Ctrl+C, SIGTERM) MUST follow the existing interruption contract: active children are terminated and no
  later write starts. Because every step converges, running setup again MUST complete an interrupted setup.

## 6. Publish

### 6.1 Automatic launcher pin

- Inside the remote lease and before deployment, when the launcher's `enois-preview` dependency differs from the
  running version, `publish` and `resume` MUST repin it (dependency and lockfile) in one commit made by the tool,
  recorded as a journal intent so that `resume` can reconcile it.
- A launcher in another format MUST stop the operation before any launcher write, as in 5.4 step 2.
- This replaces the `launcher-pin` warning, which MUST be removed.
- An unpublished running version MUST stop the operation before any launcher write, with the message of 5.5.

### 6.2 Registry access for Codespaces

After the first image push creates the GHCR package, Codespaces of the launcher must be able to pull it. If GitHub
exposes an API that grants this, `publish` MUST use it. If not, `publish` MUST emit the warning
`registry-codespaces-access` with the package settings URL and the exact action ("Manage Codespaces access", add the
launcher repository) whenever the package was created by this operation.

### 6.3 Compatibility rule

With automatic repinning, a tool upgrade changes the Worker that serves every scenario in the catalog, including
scenarios whose images carry an older runtime. A release that changes the contract between the Worker and the runtime
inside the image incompatibly MUST change `FORMAT` and MUST be released with a breaking change commit. A Worker MUST
keep serving every catalog entry of the `FORMAT` it accepts.

## 7. Unchanged behavior

- `publish`, `resume` and `source-digest` arguments, capture, sanitization, image build, local and public validation,
  gates and warnings of 0.4.0, except as stated in sections 3.3, 4 and 6.
- The Worker (`src/`) and the runtime inside the image.
- The automatic commits `publish` makes in the launcher for configuration and catalog.
- The remote lease and `--force-lease`.

## 8. Documentation

- README, tutorial, recipes, concepts and `docs/diagnostics/installation.*` in pt-BR and en MUST describe installation
  with `npm install -g enois-preview`, the guided `setup` and the infrastructure and workspace split. The manual infrastructure procedure MUST be replaced by the guided setup, keeping only the manual token
  creation and the cases where setup stops with instructions.
- A maintainer section MUST describe the release flow: Conventional Commits, the version table of 1.2, automatic and
  manual release, recovery, and the one-time Trusted Publisher configuration.
- Documentation MUST NOT contain secrets, account IDs, user names in paths or private repository names. Paths use `~`.

## 9. Acceptance

Automated, with `gh`, `docker`, `wrangler` and `npm` replaced by controlled commands on `PATH`, as
`test/cli-journey.test.ts` already does:

1. A complete setup from nothing, confirmed interactively, creates the repository, launcher files, Worker, secrets and
   activation in the order of 5.4, and writes `infrastructure.json` without secret values.
2. A second setup on that infrastructure performs no remote write and reports every resource as `exists`.
3. Without a terminal and without `--yes`, setup prints the plan, exits 1 and writes nothing, locally or remotely.
4. With `--yes` and no terminal, setup stops before any write when `GITHUB_TOKEN` is missing, naming it.
5. Existing secrets are never overwritten; an existing Codespaces secret missing the launcher repository is updated
   without a value write.
6. Callback secret: interruption after the Worker side completes on the next run from the pending file; one side
   without a pending file stops with the guidance of 5.6.
7. A token that fails the Codespaces verification is not stored.
8. `publish` without `infrastructure.json` stops and creates nothing; infrastructure fields in a workspace
   configuration are ignored with `ignored-config-fields`; setup on a launcher in another format stops without
   writing.
9. Several Cloudflare accounts without `--account` stop setup with the list; a flag contradicting
   `infrastructure.json` stops setup.
10. `publish` repins a launcher on another version in one commit; an unpublished running version stops before any
    launcher write.
11. Journals record `toolVersion`; `resume` of a journal without it stops with the message of 3.3.
12. `enois-preview --version` prints the running version; the User-Agent carries it.
13. Release policy and workflow policy tests of 2.1.
14. The package test of 3.1.

CI:

15. The `build` workflow passes on `main`, including `prettier:check`, and the measured duration is recorded against
    the budget of section 2.
16. The formatting commit of 2.2 contains only formatting, is listed in `.git-blame-ignore-revs`, and passes
    `typecheck` and `npm test`.

Real, recorded as evidence without secrets or private names:

17. One release published from `main` by the release workflow, visible on npm with provenance and as a GitHub release
    with generated notes.
18. On the maintainer's accounts, with a new launcher name and Worker name: `npm install -g enois-preview`, `setup`
    from nothing, then `publish` of the fictional example ending with `status: "validated"`.

## External prerequisites and items to confirm during implementation

- **Maintainer, once:** configure npm Trusted Publishing for the package `enois-preview`, repository
  `renanfranca/enois-preview`, workflow `release.yml`, on the existing npm account. It is not known whether npm accepts
  a Trusted Publisher before the package exists. If it does not, the first version is published manually by the
  maintainer with `npm publish` and two-factor authentication, and later versions come only from the workflow.
- Whether GitHub allows granting a repository Codespaces access to a user-owned GHCR package through the API
  (section 6.2 defines the fallback).
- Whether a new Cloudflare account must register a `workers.dev` subdomain before the first deploy (section 5.4 step 3
  defines the fallback).
- The exact `gh` scopes and commands for user Codespaces secrets and for GHCR login with the `gh` token.

These items change how a step is performed, not the contract. If one of them makes a contract in this document
impossible, implementation MUST stop and return to the maintainer.

## Out of scope

- An experimental release channel, Sonar and Renovate.
- ESLint and the other Seed4J modules besides `init` and `prettier`.
- Shared infrastructure between operators.
- Generalizing the tool to projects other than Énóis.
- A Worker that reads the catalog at run time instead of at deploy time.
- Secret rotation and changing an operator's existing infrastructure values.
- Investigating the intermittent 401 on `/assets/*.js` seen in headless Chromium.
- The manual scripts `add-scenario`, `pin-scenario` and `export-public`.
- Running the integration suites in CI.

## Rejected alternatives

- **Backward compatibility with 0.4.0** (adopting combined configurations, migrating launchers, resuming 0.4.0
  journals): dropped by the maintainer; new infrastructure is created instead.
- **Applying Seed4J `init` directly to this repository:** it replaces `package.json`, `README.md` and `.gitignore`.
  The configuration is generated elsewhere and copied.
- **Keeping the commit installer beside npm:** two installation paths with two identity models. Removed.
- **An unpinned launcher dependency (`latest`):** the Worker would change without a publication. The launcher pins the
  exact running version and the tool repins it.
- **Refusing to create a launcher from an unverified tool:** replaced by the factual check that the running version
  exists on npm.
- **Release Drafter notes:** most commits reach `main` without a pull request or label. Notes come from commits.
- **Keeping a hand-written changelog with version headings:** the version is only known at release time. GitHub
  releases replace it after 0.4.0.
- **One combined configuration per home:** duplicates infrastructure across workspaces.
- **Setup without confirmation:** remote creation cannot be undone by an interruption; one confirmation, or `--yes`,
  is required.
- **A separate bootstrap shell script outside the CLI:** it explains failures poorly in the middle of irreversible
  remote steps. The guidance lives in `setup`.
