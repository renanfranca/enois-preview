# Concepts

[Português do Brasil](../pt-BR/CONCEPTS.md) · [README](README.md) · [Flow](FLOW.md) · [Recipes](RECIPES.md)

Read this guide before running the first command. It explains the words that appear in the tool's messages and why the tool behaves the way it does.

## Glossary

### The three applications

Énóis ([enois.ia.br](https://enois.ia.br)) is a free, nonprofit social network without ads, built together with its community. It is made of three applications, which are the published sources: `enois-backend` (Spring Boot, Java 25), which keeps its data in an **H2** database, a Java database stored in a local file; `enois-frontend` (Nuxt); and `enois-design-system` (npm package). The fictional example pins their commits in [example/sources.json](../../example/sources.json).

**Why it matters to you:** all three need a clean tree with your changes already committed by you. The tool exports the commits and never commits to or changes these repositories.

### PR (pull request)

A pull request (PR) is a code review request on GitHub: you propose changes to one of the three applications and other people read and test them before accepting.

**Why it matters to you:** in the PR, you need to show that the change works. enois-preview exists so the PR can carry a link where reviewers open the change running and explore it however they prefer, without relying only on screenshots and videos and without setting anything up on their own machine.

### Operator and visitor

The **operator** is whoever opens the PR and runs enois-preview in their own terminal to publish the link. A **visitor** is anyone who has the link and opens it in a browser, for example someone reviewing the PR.

**Why it matters to you:** this guide speaks to the operator. Visitors install nothing and share the same accounts, data and upload capacity. In a public PR, anyone reading the PR can also be a visitor; what that requires of the data is in [Show in the PR that the problem is fixed](RECIPES.md#9-show-in-the-pr-that-the-problem-is-fixed).

### CLI

The command line interface: the `enois-preview` command (`setup`, `publish`, `resume` and `source-digest`) that you run in your machine's terminal.

**Why it matters to you:** error messages and the final JSON come from the CLI. It runs only on your machine; visitors never use it.

### Worker, Durable Object and Codespace

A **Codespace** is a cloud development machine from GitHub; it is where the app runs for the visitor. The Cloudflare **Worker** is the program that answers the public link. Each published link has a **Durable Object**, a small piece of state kept by Cloudflare, which remembers whether a Codespace exists, which phase it is in and when the last interaction happened.

**Why it matters to you:** the Codespace boots by itself. If you need to open its terminal to start something, that is a boot failure, not a normal step.

### GHCR

GitHub Container Registry, where GitHub stores Docker images. The tool pushes to a **private** package of yours in GHCR the image with the app that the Codespace boots from.

**Why it matters to you:** `publish` needs your GHCR authentication. The image is referenced by its digest, so an already published link never switches to another image.

### Launcher

The operator's **private** GitHub repository. It holds the Worker (`launcher.ts` and `wrangler.jsonc`), the catalog of publications, each publication's Codespace configuration in `.devcontainer/<slug>/` (the **devcontainer**, a GitHub file that tells the Codespace which image to use and how to boot) and `tool.lock.json`, which pins the public tool commit. The paths are in [Where files live](#where-files-live).

**Why it matters to you:** `publish` commits and pushes to this repository for you. Do not edit the catalog by hand to complete a publication; use `resume`.

### Scenario

Short name you choose for a preview, such as `my-scenario`. Only lowercase letters, digits and single hyphens between them are accepted. You pass it in `enois-preview publish <scenario>`.

**Why it matters to you:** each scenario keeps its own frozen copy of your data. Publishing the same scenario again reuses that copy; a new scenario copies the data again.

### Revision

A 64 character sha256 identifier computed over every frozen input: the scenario name, the commits of the three applications, the files exported from those commits, the data version, the image recipe (`recipe/`), the Codespace runtime (`runtime/`), the Worker (`src/`), and the compiled `dist`. The tool commit is recorded, but it is not part of the revision, because those inventories already identify what is built. The public link uses `<scenario>-<first 16 characters of the revision>`.

**Why it matters to you:** if nothing changed, the revision and the link stay the same. Any new commit produces another revision and another link, which you must paste into the PR. To resume a publication, use the **full** 64 character revision.

### Frozen data and capture

**Capture** copies the H2 database and the configured media folders to private state, without stopping, starting or waiting for your backend. If the file looks in use (`fuser` reports it, or `rede.lock.db` sits next to it), the result carries the `database-in-use` warning; if the file changed during the copy, `database-changed-during-copy`. The copy is still used, and a damaged copy shows up as a build or validation failure. Then capture **sanitizes** the copy, that is, removes sessions, tokens and passwords from it: only the selected accounts keep a login. An unrecognized credential-like column does not stop capture: it is named as `TABLE.COLUMN` in the `credential-column` warning. Those logins use invented `@enois.invalid` emails, as [Use my own data](RECIPES.md#8-use-my-own-data) explains. The result lives in `<state>/data/<id>/`, where `<state>` is the `state` field of your configuration.

**Why it matters to you:** capture happens only on a scenario's first `publish` or when you ask for `--refresh-data`. Other publications do not even read the local database. An incomplete capture never replaces the previous complete data.

### Journal

The file `<state>/operations/<revision>/journal.json`. It records the current stage, each stage's intent before its remote effect, and the result (checkpoint) of each completed stage.

**Why it matters to you:** the journal is what lets `enois-preview resume <revision>` continue exactly where it failed, without recapturing data and without repeating an accepted push.

### Lease

A lock that prevents two operations from touching the same thing at once. Local leases are files locked with `flock` (for example `<state>/publication.lock`). The remote lease is the ref `refs/heads/enois-preview-publication-lease` in the launcher.

**Why it matters to you:** if a lease is held, another operation may still be alive. Wait, or use `resume` after its owner finishes. When you know the other operation is dead, `publish --force-lease` or `resume --force-lease` deletes its remote lease, records the takeover in `journal.intents.remoteLease.forced` and reports the `lease-forced` warning. Without the flag, the tool waits and refuses as before.

### Tool commit and `install.json`

`install.json` lives inside an installation and records its public commit and the hashes of the source and `dist`. Before `publish` and `resume`, the tool recomputes those hashes. When they match, the journal and the result record that commit as `toolCommit` with `toolVerified: true`. Otherwise, such as in a development checkout or an installation changed by `npm run`, the tool still runs: it records the checkout's Git `HEAD` (or `null`), sets `toolVerified: false` and reports the `unverified-tool` warning.

The configuration no longer has a `toolCommit` field. A 0.3.x configuration that still carries it, or `service` or `installation`, loads normally; those fields are ignored and preserved, with one `ignored-config-fields` warning.

**Why it matters to you:** if the launcher's `tool.lock.json` or its `enois-preview` dependency pins another commit, publication continues with the `launcher-pin` warning naming both commits. The launcher is never repinned automatically; repin it yourself when you want the Worker to use this version.

### Warning

A message about something the tool observed that does not stop the operation, such as `source-dirty` or `database-in-use`. The final JSON of `setup`, `publish`, `resume` and `source-digest` always carries `warnings: [{code, message}]`, and each warning is also printed on stderr as `warning: <message>`.

**Why it matters to you:** only three things stop an operation: the application does not build or run, the tool cannot identify the revision it built and published, or a selected account cannot log in. Read the warnings before sharing the link.

## In one sentence

You point enois-preview at commits of the three Énóis applications and at a copy of your data. It freezes all of that into a **revision** and returns an HTTPS link. Whoever opens the link gets a fresh Codespace running the whole app, which deletes itself after ten minutes without use.

## Code vs data

Code always comes from the **current commits** of the three applications, exported with `git archive`. Data comes from the scenario's **last capture** and stays frozen until you ask for `--refresh-data`.

| You want to | Command | Captures data? |
| --- | --- | --- |
| Show new code with the same data | `enois-preview publish <scenario>` | No |
| Show new data or media | `enois-preview publish <scenario> --refresh-data` | Yes |
| Finish a failed publication | `enois-preview resume <full-revision>` | Never |

Capture never stops your backend. The design system package is rebuilt from its commit for every image.

That is why, after the first capture, you can publish new code even with the local H2 unavailable.

## Why it is immutable

A revision never changes once frozen. The image is referenced by its GHCR digest, configuration and catalog live in launcher commits, and an existing catalog entry is never overwritten.

This gives three benefits:

1. The link pasted into the PR always shows the same code and data.
2. An interrupted publication can be resumed safely: `resume` checks the frozen files and reuses what was already accepted.
3. Two people cannot overwrite each other's revision.

The trade off: to change anything, you produce a new revision and update the PR link. An immutable link also does not promise an always running environment; it only guarantees the next boot uses the same inputs.

## Where files live

| Path | What it is |
| --- | --- |
| `~/.local/share/enois-preview/<COMMIT>/` | Immutable tool installation, with `install.json` |
| `~/.local/share/enois-preview/current` | Link to the installation in use |
| `~/.config/enois-preview-ts/config.json` | Private configuration. Change the directory with `ENOIS_PREVIEW_HOME` or `--home` |
| `<state>/scenarios/<scenario>.json` | Which data version the scenario uses |
| `<state>/data/<id>/` | Frozen, sanitized data |
| `<state>/operations/<revision>/` | Journal, frozen files and evidence for each revision |
| Launcher: `catalog/scenarios.json` | Catalog of published revisions |
| Launcher: `.devcontainer/<slug>/` | Codespace configuration for each revision |
