# enois-preview

An Énóis specific tool for immutable development and testing previews behind an HTTPS Worker and private Codespaces. Publication reports success only after the public checks pass. Read the individual acceptance results in [VALIDATION.md](../../VALIDATION.md) before treating a revision as ready to share.

[Português do Brasil](../../README.md) · [Tutorial](TUTORIAL.md) · [LLM guide](LLM.md) · [Diagnostics](../diagnostics/README.md)

Use a clean tool checkout at the full public commit pinned by the private launcher’s `tool.lock.json`. Before installation, select it with `git checkout --detach <PINNED_PUBLIC_COMMIT>`. Publication and resume verify that identity.

```sh
npm ci --ignore-scripts
npm run build
npx playwright install chromium
npm link --ignore-scripts
npm run example:prepare -- /absolute/new/fictional-workspace
enois-preview setup --config /absolute/new/fictional-workspace/.preview/config.json
enois-preview publish my-scenario
enois-preview publish my-scenario --refresh-data
enois-preview resume <full-revision>
```

This version uses strict TypeScript and ESM. Build explicitly after installation; installation lifecycle scripts are unnecessary. Development commands are `npm ci --ignore-scripts`, `npm run build`, `npm run typecheck`, `npm test`, and `npm run check`. Tests rebuild before execution. Python is not required.

New configuration, data, journals, provenance and catalog use `format: "enois-preview-ts-v1"`. The default installation is `~/.config/enois-preview-ts`. Records with historical `schema` fields or without this `format` are refused before mutation. Start a fresh installation and catalog; do not copy the old confirmation or convert Python journals. Previous files and Git history stay preserved, without a promise to resume old operations or retain old links.

The example creates isolated copies of the three public applications pinned in [example/sources.json](../../example/sources.json). It uses no private operational catalog, H2 capture or work images. Its four characters are fictional, with original vector portraits. The seed has eight posts, three illustrated, six comments, two replies and eight reactions. Lia and Rui are selected accounts; boot generates their passwords and the entry page displays them. Maya and Davi retain their profiles and content with login disabled.

Configure your own existing private infrastructure before setup. Requirements on Linux: Node 22.12 or later, Git, Java 25/Javac, Docker, `fuser`, `flock`, GitHub CLI and Cloudflare authentication. The H2 driver must match the configured database. The image recipe includes `ffmpeg` and a local image classification model; new uploads require no external storage write service.

Initial publication captures data with only the identified backend stopped. Later publications use current application commits and frozen data without reading or stopping the local database. Explicit `--refresh-data` requests a new capture; failure preserves the previous complete version. Sources come from Git commits, including a newly built design system package. Publication never changes or commits the three source applications.

Visitors share accounts, mutable state and upload capacity: 20 MiB per new file and 256 MiB per environment, excluding seed media. Boot restores seed state and generates new passwords. Runtime changes and uploads are disposable. Ten minutes without recognized interaction starts deletion; polling does not renew activity. Platform availability and quotas limit timely deletion. An immutable link does not promise an environment that is always running.

Free plan and spending block verification occurs only at installation. Publish, resume and link visits require no renewal. The tool never asks for a card, purchases resources or enables paid plans. Human confirmation is not a billing API audit. Read [Codespaces billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces) and [Durable Objects Free limits](https://developers.cloudflare.com/durable-objects/platform/pricing/).

This is a temporary development and testing preview associated with the project. [Codespaces terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#codespaces) restrict disproportionate server use and hosting production facing applications. Technical operation does not establish GitHub approval of this architecture.

Tool code is [GPLv3](../../LICENSE); retain notices from consumed projects. Local datasets and credentials belong outside public Git history. Sanitizing authentication does not anonymize operator chosen content.
