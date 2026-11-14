# Prepare an operator's private infrastructure

Use Node 24.x (`>=24 <25`); `.nvmrc` selects the 24 family with `nvm install` and `nvm use`. Node 22 is no longer qualified. The 0.3.0 update preserves catalogs, links and historical records; resuming earlier operations requires their original executor and is not validated by this update. New publications and resumes must use a verified installation of the pinned SHA, created by `install-tool`.

This one time infrastructure procedure complements the [canonical tutorial](../en/TUTORIAL.md). Public validation of this TypeScript version is recorded separately in VALIDATION.md. Creating a separate platform account was not exercised; see [the validation scope](../../VALIDATION.md). Use a local terminal and your own accounts. Keep Free plans with spending blocked; setup reminds you with the `free-plan` warning and asks for no confirmation. Do not add a payment method or enable paid services.

Start from a published public tool commit. Substitute your actual full SHA and names before running commands:

```sh
COMMIT=PUBLIC_TOOL_COMMIT
curl -fsSL "https://raw.githubusercontent.com/renanfranca/enois-preview/$COMMIT/install.sh" | bash -s -- "$COMMIT"
gh auth login
gh auth setup-git
(cd ~/.local/share/enois-preview/current && npx --no-install wrangler login)
node ~/.local/share/enois-preview/current/dist/scripts/prepare-launcher.js /absolute/new/private-launcher --repository YOUR_OWNER/YOUR_PRIVATE_LAUNCHER --tool-commit PUBLIC_TOOL_COMMIT --worker-name YOUR_WORKER_NAME
```

The generator creates an empty private catalog and a Worker importing the pinned public package. It does not create accounts, repositories, secrets, images or Workers. The installer builds the commit in `~/.local/share/enois-preview/PUBLIC_TOOL_COMMIT`, records hashes of its source and `dist` in `install.json` and links `enois-preview` from `~/.local/share/enois-preview/current`; publication and resume record whether the installation still matches that record, and report the `unverified-tool` warning when it does not. `install.sh` comes from the commit itself and only prepares the installer in a temporary directory; the installer also installs the Chromium used by public validation. For a commit earlier than 0.3.9, use the [manual path](../en/RECIPES.md#1-install-or-switch-the-tool-to-another-pinned-commit). The generator and `wrangler` run from the installation.

In the generated launcher directory, run `npm install --package-lock-only --ignore-scripts`, `npm ci --ignore-scripts`, `npm run build`, `npm test`, and `npm run check`. Review `package.json`, `package-lock.json`, `tool.lock.json`, `launcher.ts` and `wrangler.jsonc`. Create your private GitHub repository with `gh repo create YOUR_OWNER/YOUR_PRIVATE_LAUNCHER --private`. Initialize a local Git repository, commit these reviewed files on your chosen publication branch and push that branch. Confirm `gh repo view YOUR_OWNER/YOUR_PRIVATE_LAUNCHER --json isPrivate` reports true. Never add work captures or database files.

Run `npx wrangler deploy` from this launcher with `LAUNCH_ENABLED` still false. Record its stable HTTPS origin and the account ID from `npx wrangler whoami`. This reserves the address without launching a Codespace. Public development tool configuration is disabled; do not deploy from the public source checkout.

Authenticate Docker to GHCR using a classic token with `write:packages`, entered through your credential manager or `docker login ghcr.io --username YOUR_OWNER --password-stdin`; never use a token as an argument. A new destination package must exist before setup checks it. You can reserve it with a harmless scratch image: create a new empty directory containing only a `Dockerfile` with `FROM scratch`, build it with your private registry name and tag `bootstrap`, then push that tag. The first package visibility defaults to private; verify Private in its settings and grant the private launcher **Manage Codespaces access**. Do not change visibility to public. [GitHub registry authentication and visibility](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry), [Codespaces package access](https://docs.github.com/en/codespaces/reference/allowing-your-codespace-to-access-a-private-registry).

Create a restricted GitHub fine-grained token selecting only this launcher, with Contents read, Codespaces read/write and Codespaces metadata read. Store it only in the Worker using `npx wrangler secret put GITHUB_TOKEN`. These permissions support the [Codespaces endpoints](https://docs.github.com/en/rest/codespaces/codespaces) and [machine lookup](https://docs.github.com/en/rest/codespaces/machines). Do not reuse a registry publishing token as the Worker management token.

Generate and store a unique callback secret in your password manager. Set Worker `CALLBACK_SECRET` using `npx wrangler secret put CALLBACK_SECRET`. In GitHub's account Codespaces secrets, grant only this launcher access to `DEMO_CALLBACK_SECRET` with the same value, `DEMO_WORKER_URL` with the HTTPS origin, and `REDE_SECURITY_ENCRYPTION_KEY` with 32 random bytes in standard Base64. Do not overwrite existing secrets when reusing an installation. GitHub supplies its own runtime token and forwarding variables. [Manage Codespaces secrets](https://docs.github.com/en/codespaces/managing-your-codespaces/managing-your-account-specific-secrets-for-github-codespaces).

Change only `LAUNCH_ENABLED` to true in the private launcher configuration, review and push that bootstrap change. Fill your private scenario configuration with this repository, branch, registry, origin and account ID. Run `enois-preview setup --config PRIVATE_JSON` locally, then follow the tutorial. Setup validates existing infrastructure; subsequent publication owns the image/config/catalog/deploy sequence. Do not manually complete those stages after a publication failure: use `resume`.

This version refuses Python records and removes `--legacy-verification`. Preserve previous files and commits, begin with new configuration and catalog in `enois-preview-ts-v1`, and run `setup` for this installation. Preserve existing secrets.

The launcher build compiles its dependency and runs `npm rebuild --ignore-scripts enois-preview` to create the npm CLI link after compilation. Installation scripts remain disabled.
