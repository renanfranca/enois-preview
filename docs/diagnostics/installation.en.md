# Prepare the operator's private infrastructure

`enois-preview setup` creates and checks your private infrastructure in your own GitHub and Cloudflare accounts. This guide describes what it does, what you must do by hand (the Worker token) and the cases where it stops with instructions. It complements the [tutorial](../en/TUTORIAL.md). Keep the free plans with spending blocked; setup reminds you with the `free-plan` warning. Do not add a payment method or enable paid services.

## Install and run

Use Linux with Node 24.x (`>=24 <25`), Git, Java 25 and Javac, Docker, `flock` and the GitHub CLI.

```sh
npm install -g enois-preview
enois-preview setup
```

Full interface:

```
enois-preview setup [--config WORKSPACE_JSON] [--yes]
                    [--launcher OWNER/REPO] [--branch BRANCH] [--registry ghcr.io/OWNER/NAME]
                    [--worker NAME] [--account CLOUDFLARE_ACCOUNT_ID]
```

| Flag         | Default (`<login>` is your GitHub login)       |
| ------------ | ---------------------------------------------- |
| `--launcher` | `<login>/enois-preview-launcher`               |
| `--branch`   | `main`                                         |
| `--registry` | `ghcr.io/<login>/enois-preview`                |
| `--worker`   | `enois-preview-launcher`                       |
| `--account`  | the only account reported by `wrangler whoami` |

Without `--config`, setup configures only the infrastructure. With `--config`, it also validates the workspace and stores it in `<home>/config.json`. Values in an existing `infrastructure.json` take precedence over defaults; a flag that contradicts that file stops setup naming both values, because changing infrastructure is out of scope.

## What setup does, in order

Each step checks first and acts only on what is missing. Running it again on a complete infrastructure performs no remote write and reports every resource as `exists`.

1. **Tools and logins.** Checks the required commands, the GitHub CLI login with the `repo`, `codespace` and `write:packages` scopes, the Docker login to `ghcr.io` and the `wrangler` login. Each fix (`gh auth login`, `gh auth refresh`, `docker login ghcr.io` with the `gh` token on stdin, `wrangler login`) asks its own confirmation and needs an interactive terminal; `--yes` does not replace it. Without a terminal, setup stops and prints the command to run.
2. **Plan.** Before any other write, prints on stderr one line per resource with `exists`, `create` or `update`: repository, branch, Worker, origin, each secret by name, launcher format, Chromium and local files. When there is a `create` or `update`, it asks one confirmation; any answer other than yes ends with exit 1 and nothing written. With `--yes`, it proceeds without asking. Without a terminal and without `--yes`, it ends with `Setup needs to create or update infrastructure; rerun in an interactive terminal or with --yes.` and writes nothing.
3. **Launcher.** When the repository does not exist, creates it private, generates the launcher files (`package.json` with exact `enois-preview` at the running version and `wrangler`, `package-lock.json`, `launcher.ts`, `wrangler.jsonc`, an empty catalog), commits as `enois-preview` and pushes the branch. When it exists, it must be writable and have `main: "launcher.ts"` and matching `GITHUB_REPOSITORY` and `GITHUB_OWNER` in `wrangler.jsonc`. A launcher that is not private produces the `launcher-not-private` warning.
4. **Worker.** When it does not exist, deploys the launcher with `LAUNCH_ENABLED=false` and records the origin `https://<worker>.<subdomain>.workers.dev`.
5. **Secrets.** Stores the missing ones, always on stdin (table below). An existing secret is never overwritten; an existing Codespaces secret that does not include the launcher gets the launcher added to its selection, without changing the value (`update` in the plan).
6. **Activation.** With every secret present, sets `LAUNCH_ENABLED` to `true`, commits, pushes and deploys.
7. **Chromium and local files.** Installs the Chromium used by public validation when missing (a failure becomes the `browser-missing` warning with the retry command) and writes `~/.config/enois-preview-ts/infrastructure.json` (mode `0600`, no secrets) and, with `--config`, the workspace `config.json`.

The GHCR package does not need to exist: the first `publish` creates it by pushing the image and shows the `registry-codespaces-access` warning. Follow it: in the package settings, under **Manage Codespaces access**, add the launcher repository. Do not make the package public. See [allowing your codespace to access a private registry](https://docs.github.com/en/codespaces/reference/allowing-your-codespace-to-access-a-private-registry).

Setup ends with JSON carrying `status: "configured"`, the infrastructure fields, `created`, `updated` and `warnings`.

## Secrets

| Secret                         | Where                                            | Source                             |
| ------------------------------ | ------------------------------------------------ | ---------------------------------- |
| `GITHUB_TOKEN`                 | Worker secret                                    | fine-grained token you create      |
| `CALLBACK_SECRET`              | Worker secret                                    | generated by setup                 |
| `DEMO_CALLBACK_SECRET`         | Codespaces user secret, launcher repository only | same value as `CALLBACK_SECRET`    |
| `DEMO_WORKER_URL`              | Codespaces user secret, launcher repository only | the Worker origin                  |
| `REDE_SECURITY_ENCRYPTION_KEY` | Codespaces user secret, launcher repository only | generated: 32 random bytes, Base64 |

No value appears in arguments, output, logs, journals or `infrastructure.json`.

### Create the Worker token (manual)

The Worker `GITHUB_TOKEN` is the only manual step. Setup prints the URL and permissions and reads the token from a hidden prompt; that prompt needs an interactive terminal, even with `--yes`. Create the token at <https://github.com/settings/personal-access-tokens/new>:

- **Resource owner:** the launcher owner.
- **Repository access:** "Only select repositories", the launcher only.
- **Repository permissions:** Contents: Read-only; Codespaces: Read and write; Codespaces metadata: Read-only.

Before storing it, setup verifies the token by listing the launcher's Codespaces with it. A token that fails is not stored, and setup asks again. Setup never uses the `gh` token for this secret. These permissions cover the [Codespaces endpoints](https://docs.github.com/en/rest/codespaces/codespaces).

### Both sides of the callback secret

`CALLBACK_SECRET` (Worker) and `DEMO_CALLBACK_SECRET` (Codespaces) must hold the same value, and neither can be read back. Setup therefore writes the generated value to `~/.config/enois-preview-ts/pending-callback-secret` (mode `0600`) before writing both sides and deletes the file at the end. If an interruption leaves only one side written, the next `setup` completes the other side from the pending file.

## When setup stops

| Situation                                                                                        | What to do                                                                                                                                       |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| A required command is missing, or you declined a login fix                                       | Install the command or run the login command shown, then repeat `enois-preview setup`.                                                           |
| `Several Cloudflare accounts are available; choose one with --account: ...`                      | Repeat with `--account` and one of the listed IDs.                                                                                               |
| A flag contradicts `infrastructure.json`                                                         | Use the recorded values; changing infrastructure is not supported.                                                                               |
| The launcher is not writable or does not match `wrangler.jsonc`                                  | Use a launcher you can write to, or choose another `--launcher`.                                                                                 |
| `Launcher ... uses another format ...`                                                           | It is an older launcher (for example 0.4.0, with `tool.lock.json` and a `codeload` dependency). Choose a new `--launcher`; setup never migrates. |
| `enois-preview <version> is not published on npm; run setup from an installed release.`          | Run setup from the tool installed from npm, not from a development checkout.                                                                     |
| `Worker ... did not deploy to workers.dev. ...`                                                  | Register a `workers.dev` subdomain in the Cloudflare dashboard (Workers & Pages) and repeat.                                                     |
| `CALLBACK_SECRET and DEMO_CALLBACK_SECRET must hold the same value, only one of them exists ...` | Delete the secret the message names, with the command shown, and repeat.                                                                         |
| `GITHUB_TOKEN` failed verification                                                               | Create the token again with the permissions above and repeat.                                                                                    |
| Plan declined, or no terminal and no `--yes`                                                     | Repeat in an interactive terminal or with `--yes`.                                                                                               |

Interrupting setup (Ctrl+C) is safe: every step converges, and running `enois-preview setup` again completes what was missing.

## Infrastructure from earlier versions

Infrastructure created by hand for 0.4.0 or earlier stays intact, and old links keep working while the old Worker and launcher exist. Setup does not migrate it: for npm distribution, run setup with a new `--launcher` and `--worker`.
