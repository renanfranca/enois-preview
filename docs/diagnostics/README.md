# Installation and recovery diagnostics / Diagnóstico

Private configuration contains absolute workspace/repository, H2, driver, media, service and state paths, an existing private launcher repository and branch, private GHCR destination, Worker origin and Cloudflare account. A public source checkout intentionally contains none of an operator's private captures, working catalog or credentials. The initial provisioning recipes are available in [English](installation.en.md) and [português do Brasil](installation.pt-BR.md). Their complete independent walkthrough remains pending in VALIDATION.md; no operator should copy another person's private files.

Keep `state/restoration.json` until the prior backend state is confirmed. Restore its exact service configuration before retrying if it differs. Check service ownership and H2 handles; never remove a database lock or signal a process inferred solely from a port. An initially stopped backend must remain stopped.

For recorded revisions, inspect private `operations/<revision>/journal.json`, `build.log`, `runtime.log`, `failure.json`, `image-evidence.json`, `local-validation.json` and `public-validation.json` when present. These are individual checkpoints, not proof that later stages completed. Raw captures remain under private staging on incomplete capture; they must never be copied to a Docker context or public repository.

The remote ref `refs/heads/enois-preview-publication-lease` identifies a serialized publication by its commit message operation ID. A remote outcome may be ambiguous after a lost acknowledgement. Resume queries the destination first. If identity remains unresolved, inspect the destination with the operator rather than deleting state or publishing another artifact. No force push or paid fallback is allowed.

Legacy images keep the single `{email,password}` callback, `seed/account.txt`, schemas 1/2 and blocked uploads. Current images use `{accounts:[{id,email,label,password}]}`, `seed/accounts.tsv`, and schema 3 data inventories. Catalog entries with `revision` and `accounts` validate those exact callback identities. Existing catalog fields and digests are immutable.
