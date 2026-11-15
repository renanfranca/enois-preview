# enois-preview

A command line tool that publishes a preview link for a pull request (PR), a code review request on GitHub, made to one of the applications of Énóis. Énóis ([enois.ia.br](https://enois.ia.br)) is a free, nonprofit social network without ads, built together with its community. Whoever opens the link gets the whole app running, with realistic data, in a disposable environment.

[Português do Brasil](../../README.md) · [Concepts](CONCEPTS.md) · [Flow](FLOW.md) · [Recipes](RECIPES.md) · [Tutorial](TUTORIAL.md) · [Releases](https://github.com/renanfranca/enois-preview/releases)

## The problem

In an Énóis PR, whoever fixes a problem today proves the fix with screenshots and videos, often one recorded on a phone and another on a desktop. Reviewers only see what was recorded: they cannot follow another path, try another screen size or open the change on their own device. And setting up the backend, the frontend and the design system running together, with data that looks real, on every reviewer's machine is slow and fragile.

With a preview link in the PR, reviewers open the change running in a real environment and explore it however they prefer, including on their own phone. The link becomes the main evidence of the fix; a screenshot can go with it, but never replaces it. What to paste into the PR and which data to use are in [Show in the PR that the problem is fixed](RECIPES.md#9-show-in-the-pr-that-the-problem-is-fixed).

enois-preview solves this for whoever opens the PR (the operator). You run `enois-preview publish <scenario>` in your terminal, where the [scenario](CONCEPTS.md#scenario) is a short name you choose, and get an HTTPS link. When someone opens the link, a GitHub Codespace, a cloud development machine from GitHub, boots by itself with the three applications at your commits and a [sanitized](CONCEPTS.md#frozen-data-and-capture) copy of your data, without sessions, tokens or passwords. After ten minutes without use, the environment is deleted.

In short:

- **On `publish`:** the tool takes the committed `HEAD` of each application, copies data only when needed, freezes everything into an immutable [revision](CONCEPTS.md#revision), builds the app's Docker image, writes the configuration to your [launcher](CONCEPTS.md#launcher) (a private repository of yours on GitHub), deploys the [Worker](CONCEPTS.md#worker-durable-object-and-codespace) (the Cloudflare program that answers the link), and reports success only after opening the link and checking that the app is up, runs the expected revision and lets the selected accounts log in.
- **On a visit:** the Worker creates the Codespace, shows the accounts and passwords generated at boot, and forwards browsing to the app.

Each side, step by step, is in Flow: [what happens during `publish`](FLOW.md#what-happens-during-publish) and [what happens when someone opens the link](FLOW.md#what-happens-when-someone-opens-the-link).

## Where things run

The [CLI](CONCEPTS.md#cli), the `enois-preview` command, runs on your machine, where the three applications and the local [H2 database](CONCEPTS.md#the-three-applications) also live. On `publish`, it pushes the image to a private package of yours in GHCR (GitHub's Docker image registry), writes the configuration to the launcher and deploys the Worker to Cloudflare. Whoever opens the link, the [visitor](CONCEPTS.md#operator-and-visitor), talks only to the Worker, which creates the Codespace from that image and that configuration. Inside the Codespace, a gateway forwards browsing to the backend and the frontend.

**[See the diagram and what each part does in Flow](FLOW.md#where-things-run)**

## Commands

| Command                                                  | Purpose                                                                                   | Recipe                                                                |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `enois-preview setup`                                    | Creates or checks your infrastructure: launcher, Worker and secrets                       | [Install and set up](RECIPES.md#1-install-or-update-the-tool)         |
| `enois-preview setup --config <file>`                    | Also validates and stores the workspace configuration                                     | [My data](RECIPES.md#8-use-my-own-data)                               |
| `enois-preview publish <scenario>`                       | Publishes current commits with the scenario's frozen data                                 | [New code](RECIPES.md#3-publish-again-with-new-code-only)             |
| `enois-preview publish <scenario> --refresh-data`        | Captures new data and publishes                                                           | [New data](RECIPES.md#4-publish-with-new-data)                        |
| `enois-preview publish <scenario> --accounts ID[,ID...]` | Selects the visitor accounts without a terminal prompt                                    | [My data](RECIPES.md#8-use-my-own-data)                               |
| `... --force-lease` (on `publish` or `resume`)           | Removes a remote lease held by another operation and continues                            | [Lease](CONCEPTS.md#lease)                                            |
| `enois-preview resume <full-revision>`                   | Continues a failed publication, without recapturing data                                  | [Resume](RECIPES.md#5-resume-a-failed-publication)                    |
| `enois-preview source-digest`                            | Read only: reports the logical digest of the source database, even while the backend runs | [Check the database](RECIPES.md#7-check-whether-the-database-changed) |

`enois-preview --help` prints the summary and `enois-preview --version` prints the running version. Every command accepts `--home <directory>` to use another workspace directory.

`setup`, `publish`, `resume` and `source-digest` end with one JSON result that always carries `warnings: [{code, message}]`. A warning never stops the operation; it is also printed on stderr as `warning: <message>` when observed. Only three things stop an operation: the application fails to build or run, the tool cannot identify the revision it built and published, or a selected account cannot log in.

## Requirements

- Linux with Node 24.x (`>=24 <25`); `.nvmrc` selects the 24 family.
- Git, Java 25 and Javac, Docker, `flock` and GitHub CLI. `fuser` is optional: when present, it helps report a database in use.
- A GitHub account and a Cloudflare account. `setup` checks the GitHub CLI, Docker (GHCR) and `wrangler` logins and offers each fix.
- Your own private infrastructure: a private launcher repository, a Cloudflare Worker and five secrets. `setup` creates whatever is missing in your accounts; the GHCR package is created by the first `publish`. Details are in [installation diagnostics](../diagnostics/installation.en.md).
- The H2 driver must match the configured database. The image recipe includes `ffmpeg` and a local image classification model; new uploads require no external storage write service.
- Python is not required.

To change the tool itself, see [Developing the tool](#developing-the-tool).

## Installation

Install the tool from npm and run the guided setup:

```sh
npm install -g enois-preview
enois-preview setup
```

`setup` checks tools and logins, prints a plan on stderr with one line per resource (`exists`, `create` or `update`) and writes only after your confirmation. It creates the private launcher, deploys the Worker, stores the secrets (`GITHUB_TOKEN` is a token you create and paste into a hidden prompt), enables the launcher, installs the Chromium used by public validation and writes `~/.config/enois-preview-ts/infrastructure.json`. Running it again writes nothing when everything exists. Flags, defaults and the cases where it stops are in [installation diagnostics](../diagnostics/installation.en.md).

With the infrastructure ready, the first publication with the fictional example is:

```sh
node "$(npm root -g)/enois-preview/dist/example/prepare.js" ~/fictional-workspace
enois-preview setup --config ~/fictional-workspace/.preview/config.json
enois-preview publish my-scenario
```

Attention:

- Configuration has two parts. Infrastructure (`repository`, `branch`, `registry`, `worker`, `origin` and `cloudflareAccountId`) is stored once per operator in `infrastructure.json`, mode `0600`, without secrets; the `ENOIS_PREVIEW_INFRASTRUCTURE` variable overrides its path. The workspace (applications, database, H2 and scripts) stays in `<home>/config.json`. Without `infrastructure.json`, `publish`, `resume` and `source-digest` stop with `Infrastructure missing. Run enois-preview setup first.`. A workspace field the contract does not define, including an infrastructure field, produces the `ignored-config-fields` warning.
- `publish` and `resume` record the running version as `toolVersion` in the journal and the result. When the launcher depends on another `enois-preview` version, `publish` repins the dependency in one commit made by the tool, inside the lease and before deployment. To update, run `npm install -g enois-preview@<version>`.
- Revisions created before npm distribution (0.4.0 or earlier) are not resumed: `resume` stops and asks for a new `publish`. A 0.4.0 launcher (with `tool.lock.json` and a `codeload` dependency) is not migrated: choose a new `--launcher` in `setup`.
- Removed with npm distribution: `install.sh`, the `enois-preview install` command, `install.json`, the `prepare-launcher` script, `tool.lock.json` in launchers and the `unverified-tool` and `launcher-pin` warnings. Installation is through npm, and `setup` generates the launcher.
- Configuration, data, [journals](CONCEPTS.md#journal), provenance and catalog use `format: "enois-preview-ts-v1"`. The default workspace directory is `~/.config/enois-preview-ts`.

The first publication, with fictional data, is in the [tutorial](TUTORIAL.md).

## Documentation map

| Document                                                          | When to read                                                                        |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [Concepts](CONCEPTS.md)                                           | First: revision, capture, launcher, journal, lease                                  |
| [Flow](FLOW.md)                                                   | To understand what happens on `publish` and on a visit                              |
| [Tutorial](TUTORIAL.md)                                           | For the first publication, with the fictional example                               |
| [Recipes](RECIPES.md)                                             | Day to day: publish again, refresh, resume, interruptions, errors                   |
| [Diagnostics](../diagnostics/README.md)                           | To prepare infrastructure or investigate a failure                                  |
| [LLM guide](LLM.md)                                               | If an assistant will help you operate                                               |
| [Releases](https://github.com/renanfranca/enois-preview/releases) | To see what changed in each release (up to 0.4.0, in the [changelog](CHANGELOG.md)) |
| [Releases and CI](RELEASING.md)                                   | If you maintain the tool: commits, versions, release and recovery                   |

## Limits and costs

- Publication never changes or commits the three source applications. It publishes only their committed `HEAD`; staged, unstaged or untracked changes produce the `source-dirty` warning and are left out.
- Code always comes from the current commits and data stays frozen since the scenario's last capture, which reads the local database only on the first publication or with `--refresh-data`. Details are in [Code vs data](CONCEPTS.md#code-vs-data).
- Visitors share accounts, data and Codespace disk, and one visitor can change a shared account's password until the environment recycles. Each uploaded file is limited to 100 MB. The environment is deleted after ten minutes without interaction. In a public PR, the link is public too, and all content of the captured data is visible. The exact limits and which data to use are in [Show in the PR that the problem is fixed](RECIPES.md#9-show-in-the-pr-that-the-problem-is-fixed).
- `setup` prints a `free-plan` warning about Free plans and spending blocks; it asks for no confirmation and is not a billing API audit. The tool never asks for a card, purchases resources or enables paid plans. Read [Codespaces billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces) and [Durable Objects Free limits](https://developers.cloudflare.com/durable-objects/platform/pricing/).
- This is a temporary development and testing preview associated with the project. [Codespaces terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#codespaces) restrict disproportionate server use and hosting production facing applications. Technical operation does not establish GitHub approval of this architecture.

## For auditing

Publication reports success only after the public gates pass: readiness, revision identity and login of each selected account. Media, decoding, permissions, cookies and image inventory checks still run and appear as warnings. The individual acceptance results, with evidence per release, are in [VALIDATION.md](../../VALIDATION.md); read it before treating a revision as ready to share. For failures and recovery, see [diagnostics](../diagnostics/README.md).

## Developing the tool

The tool uses strict TypeScript and ESM, built explicitly. Development commands are `npm ci`, `npm run build`, `npm run typecheck`, `npm test` and `npm run check`; tests rebuild before execution. Code follows Prettier (`npm run prettier:check`; a pre-commit hook formats changed files). A development checkout runs as `0.0.0-SNAPSHOT` and never creates or repins launchers, because that version is not on npm. Commits follow Conventional Commits; CI and release are described in [Releases and CI](RELEASING.md).

## License

Tool code is [GPLv3](../../LICENSE); retain notices from consumed projects. Local datasets and credentials belong outside public Git history. Sanitizing authentication does not anonymize operator chosen content.
