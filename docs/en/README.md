# enois-preview

An Énóis specific tool for immutable development and testing previews behind an HTTPS Worker and private Codespaces. Publication reports success only after the public checks pass. Read the individual acceptance results in [VALIDATION.md](../../VALIDATION.md) before treating a revision as ready to share.

[Português do Brasil](../../README.md) · [Tutorial](TUTORIAL.md) · [LLM guide](LLM.md) · [Diagnostics](../diagnostics/README.md)

Install the tool with the installer, at the full public commit pinned by the private launcher’s `tool.lock.json`. The installer downloads that commit’s archive from GitHub, builds it outside your checkouts in `~/.local/share/enois-preview/<COMMIT>`, records the hashes of its source and `dist` in `install.json`, points `current` at it and links the `enois-preview` command. Publication and resume recompute those hashes and refuse, before any effect, an installation that differs from its record or from `toolCommit`. A development checkout cannot publish, even when clean at the same commit. Installations are immutable: install another commit for another version. Do not run `npm run` inside one, because it rebuilds `dist`. Revisions frozen by 0.3.1 or earlier resume only with their original executor: a clean checkout at their commit, built with `npm run build`.

```sh
git clone https://github.com/renanfranca/enois-preview.git /absolute/temporary/enois-preview
cd /absolute/temporary/enois-preview
git checkout --detach <PINNED_PUBLIC_COMMIT>
npm ci --ignore-scripts
npm run build
node dist/scripts/install-tool.js --commit <PINNED_PUBLIC_COMMIT>
cd ~/.local/share/enois-preview/current
npx --no-install playwright install chromium
node dist/example/prepare.js /absolute/new/fictional-workspace
enois-preview setup --config /absolute/new/fictional-workspace/.preview/config.json
enois-preview publish my-scenario
enois-preview publish my-scenario --refresh-data
enois-preview resume <full-revision>
```

In 0.3.1, `Ctrl+C` (`SIGINT`) and `SIGTERM` cancel active commands and prevent later stages. The first signal determines exit status: `130` or `143`, respectively. Wait for backend restoration; further signals do not interrupt it. If restoration fails within its existing deadlines, preserve `restoration.json`: the next publication or resume attempts recovery before inspecting sources. An incomplete capture preserves previous complete data. Once a revision is frozen, use the reported identity with `enois-preview resume <full-revision>`; an accepted push or deployment may need reconciliation because cancelling the local wait does not undo the remote effect. Never remove another operation’s lease. `SIGKILL` relies on durable recovery during the next invocation.

This version uses strict TypeScript and ESM. Build explicitly after installation; installation lifecycle scripts are unnecessary. Development commands are `npm ci --ignore-scripts`, `npm run build`, `npm run typecheck`, `npm test`, and `npm run check`. Tests rebuild before execution. Python is not required.

New configuration, data, journals, provenance and catalog use `format: "enois-preview-ts-v1"`. The default installation is `~/.config/enois-preview-ts`. Records with historical `schema` fields or without this `format` are refused before mutation. Start a fresh installation and catalog; do not copy the old confirmation or convert Python journals. Previous files and Git history stay preserved, without a promise to resume old operations or retain old links.

The example creates isolated copies of the three public applications pinned in [example/sources.json](../../example/sources.json). It uses no private operational catalog, H2 capture or work images. Its four characters are fictional, with original vector portraits. The seed has eight posts, three illustrated, six comments, two replies and eight reactions. Lia and Rui are selected accounts; boot generates their passwords and the entry page displays them. Maya and Davi retain their profiles and content with login disabled.

Configure your own existing private infrastructure before setup. Requirements on Linux: Node 24.x (`>=24 <25`), Git, Java 25/Javac, Docker, `fuser`, `flock`, GitHub CLI and Cloudflare authentication. The H2 driver must match the configured database. The image recipe includes `ffmpeg` and a local image classification model; new uploads require no external storage write service.

Initial publication captures data with only the identified backend stopped. Later publications use current application commits and frozen data without reading or stopping the local database. Explicit `--refresh-data` requests a new capture; failure preserves the previous complete version. Sources come from Git commits, including a newly built design system package. Publication never changes or commits the three source applications.

Visitors share accounts, mutable state and upload capacity: 20 MiB per new file and 256 MiB per environment, excluding seed media. Boot restores seed state and generates new passwords. Runtime changes and uploads are disposable. Ten minutes without recognized interaction starts deletion; polling does not renew activity. Platform availability and quotas limit timely deletion. An immutable link does not promise an environment that is always running.

Free plan and spending block verification occurs only at installation. Publish, resume and link visits require no renewal. The tool never asks for a card, purchases resources or enables paid plans. Human confirmation is not a billing API audit. Read [Codespaces billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces) and [Durable Objects Free limits](https://developers.cloudflare.com/durable-objects/platform/pricing/).

This is a temporary development and testing preview associated with the project. [Codespaces terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#codespaces) restrict disproportionate server use and hosting production facing applications. Technical operation does not establish GitHub approval of this architecture.

Tool code is [GPLv3](../../LICENSE); retain notices from consumed projects. Local datasets and credentials belong outside public Git history. Sanitizing authentication does not anonymize operator chosen content.
