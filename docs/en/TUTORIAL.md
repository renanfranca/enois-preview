# Publish a testing revision

[Português do Brasil](../pt-BR/TUTORIAL.md) · [README](README.md) · [Concepts](CONCEPTS.md) · [Flow](FLOW.md) · [Recipes](RECIPES.md)

This tutorial takes you from installation to the first published link, using the fictional example. Day to day situations (publish again, refresh, resume, interruptions) are in the [recipes](RECIPES.md).

## Before you start

- Have the [README requirements](README.md#requirements) and your private infrastructure ready: a private [launcher](CONCEPTS.md#launcher) with `wrangler.jsonc`, Worker and catalog, and a private [GHCR](CONCEPTS.md#ghcr) package. If anything is missing, follow [installation diagnostics](../diagnostics/installation.en.md) first.
- Have the full public commit pinned in your launcher's `tool.lock.json` at hand. Below it appears as `<PINNED_PUBLIC_COMMIT>`.

Attention:
- Use only your local terminal. Do not run commands inside a [Codespace](CONCEPTS.md#worker-durable-object-and-codespace) to complete a revision's boot.
- Never put tokens in arguments, chats or versioned files.
- Do not change billing plans.

## Step by step

1. Authenticate with GitHub:

   ```sh
   gh auth login
   ```

2. Authenticate Docker to GHCR through your credential mechanism, for example typing the token on standard input:

   ```sh
   docker login ghcr.io --username YOUR_OWNER --password-stdin
   ```

3. Clone the tool into a temporary directory:

   ```sh
   git clone https://github.com/renanfranca/enois-preview.git /absolute/temporary/enois-preview
   ```

4. Enter the clone:

   ```sh
   cd /absolute/temporary/enois-preview
   ```

5. Switch to the pinned commit:

   ```sh
   git checkout --detach <PINNED_PUBLIC_COMMIT>
   ```

6. Select Node 24.x (`>=24 <25`); `.nvmrc` names the 24 family:

   ```sh
   nvm install
   ```

7. Install dependencies without installation scripts:

   ```sh
   npm ci --ignore-scripts
   ```

8. Build:

   ```sh
   npm run build
   ```

9. Create the verified installation of that commit:

   ```sh
   node dist/scripts/install-tool.js --commit <PINNED_PUBLIC_COMMIT>
   ```

   The installer creates `~/.local/share/enois-preview/<PINNED_PUBLIC_COMMIT>`, points `~/.local/share/enois-preview/current` at it and links the `enois-preview` command. See [`toolCommit` and `install.json`](CONCEPTS.md#toolcommit-and-installjson).

   Attention: never run `npm run` or edit files inside the installation. `publish` would refuse it afterwards.

10. Enter the installation:

    ```sh
    cd ~/.local/share/enois-preview/current
    ```

11. Install the browser used by public validation:

    ```sh
    npx --no-install playwright install chromium
    ```

12. Authenticate with Cloudflare:

    ```sh
    npx --no-install wrangler login
    ```

13. Prepare the fictional workspace at a path that does not exist yet:

    ```sh
    node dist/example/prepare.js /absolute/new-workspace
    ```

    Preparation fetches the pinned public sources, builds the backend and applies its migrations to a new H2 before inserting fictional rows only.

14. Edit the private file `/absolute/new-workspace/.preview/config.json`. Replace `repository`, `branch`, `registry`, `origin` and `cloudflareAccountId` with your existing infrastructure, and set `toolCommit` to `<PINNED_PUBLIC_COMMIT>`.

    Attention: do not use another operator's infrastructure.

15. Run setup:

    ```sh
    enois-preview setup --config /absolute/new-workspace/.preview/config.json
    ```

    Verify Free plans and spending blocks for the configured accounts and answer `yes` to the confirmation in the interactive terminal. Setup verifies access and service identity and stores the configuration and confirmation in `~/.config/enois-preview-ts`. Set `ENOIS_PREVIEW_HOME` for a separate installation. Repeating setup preserves confirmation for the same infrastructure; there is no periodic renewal.

16. Publish:

    ```sh
    enois-preview publish my-scenario
    ```

    The first publication performs the [capture](CONCEPTS.md#frozen-data-and-capture). The example already selects Lia (`example_lia`) and Rui (`example_rui`) with their original permissions. The command succeeds only after validating image contents, boot, JSON readiness, every account, media and public identity. What happens at each stage is in [Flow](FLOW.md#what-happens-during-publish).

17. Open the `url` from the final JSON in a browser, test the pull request (PR)'s specific behavior and paste the link into the PR. Passwords appear on the environment's entry page, never in the CLI report.

    Attention: accounts are shared. Use independent sessions for author and reader. A completed build or push alone never establishes public acceptance; only the final JSON with `status: "validated"` does.

## What the example contains

Preparation creates isolated copies of the three public applications at the commits in [example/sources.json](../../example/sources.json). It uses no operational catalog, real H2 or private images.

- The four characters are fictional, with original vector portraits.
- The seed has eight posts (three illustrated), six comments, two replies and eight reactions.
- Lia and Rui are the selected accounts; boot generates their passwords and only the entry page shows them.
- Maya and Davi retain their profiles and content with login disabled.

## After the first publication

| Situation | Recipe |
| --- | --- |
| New code, same data | [Publish again with new code only](RECIPES.md#3-publish-again-with-new-code-only) |
| New data or media | [Publish with new data](RECIPES.md#4-publish-with-new-data) |
| `publish` failed | [Resume a failed publication](RECIPES.md#5-resume-a-failed-publication) |
| You interrupted the command | [Ctrl+C, SIGTERM or a killed process](RECIPES.md#6-ctrlc-sigterm-or-a-killed-process) |
| Your own data | [Use my own data](RECIPES.md#8-use-my-own-data) |
| Limits for whoever opens the link | [Share the link in the PR](RECIPES.md#9-share-the-link-in-the-pr) |

## Python era launcher

Before using a launcher from the Python version:

1. Preserve its catalog in Git history.
2. Prepare an empty `{ "format": "enois-preview-ts-v1", "scenarios": {} }` catalog, a `tool.lock.json` with the same format, and `launcher.ts`.
3. Pin the public dependency to the immutable TypeScript release SHA.
4. After `npm ci --ignore-scripts`, run the launcher's `npm run build`. It explicitly compiles `node_modules/enois-preview` and checks `launcher.ts`.

Attention: do not reuse earlier configuration, journals, recipes or financial confirmation. The full procedure is in [installation diagnostics](../diagnostics/installation.en.md).
