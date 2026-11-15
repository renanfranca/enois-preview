# Publish a testing revision

[Português do Brasil](../pt-BR/TUTORIAL.md) · [README](README.md) · [Concepts](CONCEPTS.md) · [Flow](FLOW.md) · [Recipes](RECIPES.md)

This tutorial takes you from installation to the first published link, using the fictional example. Day to day situations (publish again, refresh, resume, interruptions) are in the [recipes](RECIPES.md).

## Before you start

- Have the [README requirements](README.md#requirements): Node 24.x, Git, Java 25 and Javac, Docker, `flock` and the GitHub CLI, plus a GitHub account and a Cloudflare account. `setup` creates your private infrastructure ([launcher](CONCEPTS.md#launcher), Worker and secrets); the [GHCR](CONCEPTS.md#ghcr) package is created by the first `publish`.

Attention:

- Use only your local terminal. Do not run commands inside a [Codespace](CONCEPTS.md#worker-durable-object-and-codespace) to complete a revision's boot.
- Never put tokens in arguments, chats or versioned files.
- Do not change billing plans.

## Step by step

1. Select Node 24.x (`>=24 <25`) and install the tool:

   ```sh
   nvm install 24
   npm install -g enois-preview
   enois-preview --version
   ```

2. Run the guided setup:

   ```sh
   enois-preview setup
   ```

   It first checks the GitHub CLI, Docker (GHCR) and `wrangler` logins and offers each fix, with confirmation. Then it prints the plan, one line per resource with `exists`, `create` or `update`, and asks one confirmation. Along the way it prints the URL and permissions of the Worker token: create the token and paste it into the hidden prompt (step by step in [installation diagnostics](../diagnostics/installation.en.md#create-the-worker-token-manual)). The final JSON carries `status: "configured"`, the resources in `created` and `warnings`, including `free-plan`: keep the free plans with spending blocked.

   Attention: do not use another operator's infrastructure. Running setup again changes nothing that already exists.

3. Prepare the fictional workspace at a path that does not exist yet:

   ```sh
   node "$(npm root -g)/enois-preview/dist/example/prepare.js" ~/new-workspace
   ```

   Preparation fetches the pinned public sources, builds the backend and applies its migrations to a new H2 before inserting fictional data only.

4. Store the workspace configuration:

   ```sh
   enois-preview setup --config ~/new-workspace/.preview/config.json
   ```

   The infrastructure is ready, so the plan shows only the local files. The workspace configuration is stored in `~/.config/enois-preview-ts/config.json`, next to `infrastructure.json`. Set `ENOIS_PREVIEW_HOME` to keep another independent workspace.

5. Publish:

   ```sh
   enois-preview publish my-scenario
   ```

   The first publication performs the [capture](CONCEPTS.md#frozen-data-and-capture). The example already selects Lia (`example_lia`) and Rui (`example_rui`) with their original permissions. The command succeeds only after the public link reports readiness, the expected revision and a login for every selected account. Image contents, media and decoding are still checked and reported as `warnings`. What happens at each stage is in [Flow](FLOW.md#what-happens-during-publish).

   The first `publish` creates the GHCR package and shows the `registry-codespaces-access` warning with the package settings URL. There, under **Manage Codespaces access**, add the launcher repository. If public validation fails because the Codespace could not pull the image, make that change and run `enois-preview resume <full-revision>`.

6. Open the `url` from the final JSON in a browser, test the pull request (PR)'s specific behavior and paste the link into the PR. Passwords appear on the environment's entry page, never in the CLI report.

   Attention: accounts are shared. Use independent sessions for author and reader. A completed build or push alone never establishes public acceptance; only the final JSON with `status: "validated"` does.

## What the example contains

Preparation creates isolated copies of the three public applications at the commits in [example/sources.json](../../example/sources.json). It uses no operational catalog, real H2 or private images.

- The four characters are fictional, with original vector portraits.
- The seed has eight posts (three illustrated), six comments, two replies and eight reactions.
- Lia and Rui are the selected accounts; boot generates their passwords and only the entry page shows them.
- Maya and Davi retain their profiles and content with login disabled.

## After the first publication

| Situation                         | Recipe                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| New code, same data               | [Publish again with new code only](RECIPES.md#3-publish-again-with-new-code-only)                 |
| New data or media                 | [Publish with new data](RECIPES.md#4-publish-with-new-data)                                       |
| `publish` failed                  | [Resume a failed publication](RECIPES.md#5-resume-a-failed-publication)                           |
| You interrupted the command       | [Ctrl+C, SIGTERM or a killed process](RECIPES.md#6-ctrlc-sigterm-or-a-killed-process)             |
| Your own data                     | [Use my own data](RECIPES.md#8-use-my-own-data)                                                   |
| Limits for whoever opens the link | [Show in the PR that the problem is fixed](RECIPES.md#9-show-in-the-pr-that-the-problem-is-fixed) |

## Launcher from an earlier version

A Python era or 0.4.0 launcher (with `tool.lock.json` and a `codeload` dependency) is not migrated: `setup` stops and asks for a new `--launcher`. Keep the old launcher; its links keep working while it and the old Worker exist. Do not reuse journals or recipes from the earlier version.
