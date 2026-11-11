# Concepts

[Português do Brasil](../pt-BR/CONCEPTS.md) · [README](README.md) · [Flow](FLOW.md) · [Recipes](RECIPES.md)

Read this guide before running the first command. It explains the words that appear in CLI messages and why the tool behaves the way it does.

## In one sentence

You point enois-preview at commits of the three Énóis applications and at a copy of your data. It freezes all of that into a **revision** and returns an HTTPS link. Whoever opens the link gets a fresh Codespace running the whole app, which deletes itself after ten minutes without use.

## Glossary

### Scenario

Short name you choose for a preview, such as `my-scenario`. Only lowercase letters, digits and single hyphens between them are accepted. You pass it in `enois-preview publish <scenario>`.

**Why it matters to you:** each scenario keeps its own frozen data. Publishing the same scenario again reuses that data; a new scenario makes a new capture.

### Revision

A 64 character sha256 identifier computed over every frozen input: the scenario name, the commits of the three applications, the files exported from those commits, the data version, the image recipe (`recipe/`), the Codespace runtime (`runtime/`), the Worker (`src/`), the compiled `dist` and the `toolCommit`. The public link uses `<scenario>-<first 16 characters of the revision>`.

**Why it matters to you:** if nothing changed, the revision and the link stay the same. Any new commit produces another revision and another link, which you must paste into the PR. To resume a publication, use the **full** 64 character revision.

### Frozen data and capture

**Capture** stops the local backend (only if it is running), copies the H2 database and the configured media folders, and returns the backend to its previous state. Then it sanitizes the copy: only the selected accounts keep a login. The result lives in `<state>/data/<id>/`, where `<state>` is the `state` field of your configuration.

**Why it matters to you:** capture happens only on a scenario's first `publish` or when you ask for `--refresh-data`. Other publications do not even read the local database. An incomplete capture never replaces the previous complete data.

### Launcher

The operator's **private** GitHub repository. It holds the Worker (`launcher.ts` and `wrangler.jsonc`), the catalog (`catalog/scenarios.json`), each revision's configuration in `.devcontainer/<slug>/` and `tool.lock.json`, which pins the public tool commit.

**Why it matters to you:** `publish` commits and pushes to this repository for you. Do not edit the catalog by hand to complete a publication; use `resume`.

### Journal

The file `<state>/operations/<revision>/journal.json`. It records the current stage, each stage's intent before its remote effect, and the result (checkpoint) of each completed stage.

**Why it matters to you:** the journal is what lets `enois-preview resume <revision>` continue exactly where it failed, without recapturing data and without repeating an accepted push.

### Lease

A lock that prevents two operations from touching the same thing at once. Local leases are files locked with `flock` (for example `<state>/publication.lock`). The remote lease is the ref `refs/heads/enois-preview-publication-lease` in the launcher.

**Why it matters to you:** if a lease is held, another operation may still be alive. Never delete another operation's lease; wait, or use `resume` after its owner finishes.

### `restoration.json`

The file `<state>/restoration.json`, written before capture stops the backend. It says how the backend was (running or stopped) and with which service configuration.

**Why it matters to you:** if backend restoration fails, this file stays. The next `publish` or `resume` reads it and returns the backend to its previous state before inspecting sources. Do not delete it.

### `toolCommit` and `install.json`

`toolCommit` is the full public tool commit, set by you and equal to the one pinned in the launcher's `tool.lock.json`. `install.json` lives inside the installation and records that commit and the hashes of the source and `dist`.

**Why it matters to you:** before `publish` and `resume`, the tool recomputes the hashes. If the installation was changed (for example, someone ran `npm run` inside it) or belongs to another commit, it refuses before any effect.

### The three applications

The published sources are `enois-backend` (Spring Boot, Java 25, H2 database), `enois-frontend` (Nuxt) and `enois-design-system` (npm package). The fictional example pins their commits in [example/sources.json](../../example/sources.json).

**Why it matters to you:** all three need a clean tree with your changes already committed by you. The tool exports the commits and never commits to or changes these repositories.

### Worker, Durable Object and Codespace

The Cloudflare **Worker** answers the public link. Each published scenario has a **Durable Object**, which remembers whether a Codespace exists, which phase it is in and when the last interaction happened. The **Codespace** is the GitHub machine where the app runs.

**Why it matters to you:** the Codespace boots by itself. If you need to open its terminal to start something, that is a boot failure, not a normal step.

## Code vs data

Code always comes from the **current commits** of the three applications, exported with `git archive`. Data comes from the scenario's **last capture** and stays frozen until you ask for `--refresh-data`.

| You want to | Command | Captures data? |
| --- | --- | --- |
| Show new code with the same data | `enois-preview publish <scenario>` | No |
| Show new data or media | `enois-preview publish <scenario> --refresh-data` | Yes |
| Finish a failed publication | `enois-preview resume <full-revision>` | Never |

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
| `~/.config/enois-preview-ts/config.json` | Private configuration and initial Free plan confirmation. Change the directory with `ENOIS_PREVIEW_HOME` or `--home` |
| `<state>/scenarios/<scenario>.json` | Which data version the scenario uses |
| `<state>/data/<id>/` | Frozen, sanitized data |
| `<state>/operations/<revision>/` | Journal, frozen files and evidence for each revision |
| `<state>/restoration.json` | Pending backend restoration, when present |
| Launcher: `catalog/scenarios.json` | Catalog of published revisions |
| Launcher: `.devcontainer/<slug>/` | Codespace configuration for each revision |
