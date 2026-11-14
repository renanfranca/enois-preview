# Release history

[Português do Brasil](../../CHANGELOG.md) · [README](README.md)

This file records what changed in each release, newest first. The guides ([README](README.md), [tutorial](TUTORIAL.md), [recipes](RECIPES.md)) describe current behavior only. Each release's evidence is in [VALIDATION.md](../../VALIDATION.md).

## 0.4.0 (2026-11-14)

`v0.3.9` was never released: its commits ship in this version. 0.4.0 stops enforcing policy on the operator's own disposable database and applications. Only these stop an operation: an application build or run failure, a failure to identify the built and published revision, and a selected account that cannot log in. Everything else became a warning.

- **Warnings.** The final JSON of `publish`, `resume`, `setup` and `source-digest` always carries `warnings: [{code, message}]`, empty when nothing was observed. Each warning is also one stderr line prefixed `warning:`. Example: `{"code":"database-in-use","message":"..."}`.
- **Image build.** The build no longer runs application tests: the design system builds and packs without `test:dist`, the frontend builds without `typecheck` and without `npm test`, and the backend packages with `./mvnw -B -DskipTests package`. `recipe/test/` was removed. Each application's CI owns its tests.
- **No restriction patches.** The recipe no longer applies `StrictMediaSanitizer`, the `MediaService` size change, the `MediaStorageProxyController` changes, the `EmailService` change, `SIGNUP_OPEN`, the `entrar.tsx` changes or the `navigator` stub. The `enois.preview.demo` property is gone from the recipe and from `runtime/start.ts`. Mail stays disabled through `spring.mail.*` and signup through `rede.auth.signup-enabled=false`. Only functional adaptations remain (local storage, media prefixes, public origin and the design system dependency). `test:effects`, which proved the mail transport swap made by the patch, was removed.
- **Out of order migrations.** `application-demo.properties` now sets `spring.flyway.out-of-order=true` and `spring.flyway.validate-on-migrate=false`, like the backend's `qa`, `hml` and `prd` profiles. An out of order migration runs at the Codespace's first boot.
- **Capture without backend orchestration.** Capture no longer stops, starts or waits for the operator's backend. The `service` block (`status`, `identity`, `stop`, `start`, `ready`, `released`), `expectedIdentity`, `restoration.json` and the `fuser` requirement are gone. The H2 file is copied while the backend runs. A file in use (reported by `fuser` or by `rede.lock.db`) produces `database-in-use`; a file that changed during the copy produces `database-changed-during-copy`, and the copy is still used.
- **Sanitizer.** An unrecognized credential-like column produces the `credential-column` warning naming `TABLE.COLUMN` and no longer stops capture. Disabled passwords, rewritten emails and the selected accounts' logins stay. `sanitizerSha256` changed, so the next capture does not reuse data frozen by earlier versions.
- **Dirty repository.** Produces the `source-dirty` warning, stating that only the committed `HEAD` is published, and no longer stops publication.
- **Accounts.** At least one account, without the cap of 20. `email` is optional: without it, the tool generates `account<N>@enois.invalid`. Any valid email that is unique in the selection is accepted. `publish --accounts ID[,ID...]` selects accounts without a terminal; labels come from the captured listing and an unknown ID fails. Without a terminal and without accounts, the message names `--accounts`.
- **Disk space.** Low free space for the capture is the `storage-low` warning.
- **`source-digest`.** Works while the backend runs and emits `database-in-use` when applicable.
- **Tool commit.** `toolCommit` is no longer required and is no longer part of the revision identity. The journal and the final result record the running tool's commit (`toolCommit`, or `null`) and `toolVerified`. A tool that is not a verified installation, such as a development checkout, publishes with the `unverified-tool` warning.
- **Launcher.** A `tool.lock.json` or `enois-preview` dependency that differs from the running tool produces the `launcher-pin` warning naming both commits; the launcher is not repinned automatically. Launcher deployment runs only `npm ci --ignore-scripts` and `npm run build`. The `wrangler.jsonc` and configured repository checks still stop the operation.
- **Remote lease.** `publish` and `resume` gained `--force-lease`, which deletes another operation's lease, records it in `journal.intents.remoteLease.forced` and produces the `lease-forced` warning. Without the flag, nothing changes.
- **0.3.x configuration.** Still loads. `service`, `toolCommit`, `installation` and other fields no longer used are ignored and preserved, with one `ignored-config-fields` warning listing their names. Revisions created by 0.3.x have no guaranteed `resume`; a new `publish` creates a new revision.
- **Setup.** The free plan confirmation became the `free-plan` warning. The `installation` record is no longer written or required. A launcher repository or GHCR package that is not private produces a warning.
- **Validation.** Only these stop it: readiness `UP`, revision identity, and each selected account logging in with `/api/me` returning its ID. Frozen media bytes, hash and MIME, Chromium decoding, permissions, secure cookies, external reads and the `verifyImage` checks (license notices, inventories and design system) became warnings.
- **Worker.** A Codespace whose machine does not report exactly 2 CPUs is registered and logged, not refused. This applies only after the launcher is repinned to this version.
- **Gateway.** Application routes are no longer blocked. `/__demo/` stays reserved and a path containing `;` is still refused. Visitors share accounts and can change one's password until the Codespace recycles; this is accepted.
- **Uploads.** The per file limit is 100 MB in the Worker, the runtime `upload-transport` and `DemoLocalStore`, the Cloudflare free plan request body ceiling. The backend's own ceiling still applies. The 256 MiB shared limit and `test:capacity` were removed; Codespace disk is the limit.
- **Example.** `test:example` checks the counts and no longer checks `canonicalDataSha256`. The generated config has no `service`, `expectedIdentity` or `toolCommit`. The example pins the public `qa` heads of 2026-11-13: backend `3fe25eaf`, frontend `35e498b3` and design system `ecb8545`.
- One command installation: `COMMIT=<SHA>; curl -fsSL "https://raw.githubusercontent.com/renanfranca/enois-preview/$COMMIT/install.sh" | bash -s -- "$COMMIT"`. The commit's own `install.sh` prepares the installer in a temporary directory, removed at the end, and does not replace verification: the installer still downloads the commit only from `codeload.github.com` and records the hashes in `install.json`.
- New command `enois-preview install <SHA>`. With the tool already installed, it installs another verified public commit and points `current` and the command at it, with no manual clone or build.
- The installer now installs the Chromium used by public validation and reports `browser: true` in its final JSON. If the browser fails, the installation remains complete, the JSON carries `browser: false` and the message shows the command to repeat only that step.
- The manual path (clone, `npm ci`, `npm run build`, `install-tool`) still works and is the only one for commits earlier than this version. See [the recipe](RECIPES.md#1-install-or-switch-the-tool-to-another-pinned-commit).
- `publish` and `resume` before `setup` now answer `Configuration missing. Run enois-preview setup --config PRIVATE_JSON first.` instead of the command list.

## 0.3.8 (2026-11-12)

- Capture accepts databases with the private calendar and with per-message end-to-end encryption. The `CALENDAR_SUBSCRIPTIONS` table (calendar `.ics` links) is empty in the sanitized copy, and `MESSAGES.ENCRYPTED_KEYS` is `NULL` in every message, which keeps its content. Up to 0.3.7, these columns stopped capture with `Unrecognized authentication or integration column`.
- An unknown column that looks like a credential still stops capture without promoting data.
- `sanitizerSha256` changed. The next capture with `--refresh-data` therefore does not reuse data frozen by earlier versions.

## 0.3.7 (2026-11-11)

- The example service adapter (`service.js`) no longer answers `Backend ownership mismatch` for a backend that is exiting. `status` and `start` now treat that process as stopped, so capture no longer fails in that window.
- Messages, exit codes and the pidfile format are unchanged.

## 0.3.6 (2026-11-10)

- A `stop` left orphaned by a killed CLI waits only for the backend it signalled. It no longer waits for a backend started later, and no longer deletes that new backend's pidfile.

## 0.3.5 (2026-11-10)

- No operator visible change. Production code is the same as 0.3.4.
- `npm run test:capture` now proves, with real Spring and H2, that a second CLI settles a shutdown accepted by an interrupted CLI before it trusts backend readiness.

## 0.3.4 (2026-11-10)

- New `enois-preview source-digest` command. It is read only: with the source backend stopped and released, it copies the H2 database into a private directory and prints JSON with `databaseSha256`, `logicalSha256` (the H2 `SCRIPT` without `CREATE USER` lines, hashed with sha256) and per table row counts. See [the recipe](RECIPES.md#7-check-whether-the-database-changed).
- Runtime, recipe and example entry points now also work through the `current` link, as the CLI ones already did in 0.3.3.

## 0.3.3 (2026-11-10)

- The installed `service.js` and scripts work when called through the `~/.local/share/enois-preview/current` link. In 0.3.2, through that path, they did nothing and exited 0.
- Use 0.3.3 or newer instead of 0.3.2.

## 0.3.2 (2026-11-09)

- The tag exists but the release was not made: the installed `service.js` did not work through the `current` link. Use 0.3.3.
- New installer `node dist/scripts/install-tool.js --commit <SHA>`. It downloads the public commit only from `codeload.github.com`, builds it outside your checkouts and records the hashes of its source and `dist` in `install.json`. `publish` and `resume` refuse an installation that differs from that record.
- A development checkout can no longer publish. Revisions frozen by 0.3.1 or earlier resume only with their original executor: a clean checkout at their commit, built with `npm run build`.
- When a CLI dies during an accepted backend shutdown, the next CLI waits for that shutdown to finish before trusting readiness.

## 0.3.1 (2026-11-07)

- `Ctrl+C` (`SIGINT`) and `SIGTERM` cancel active commands and prevent later stages. The first signal sets the exit status: `130` or `143`.
- Further signals do not interrupt backend restoration. If it fails, `restoration.json` is kept and the next `publish` or `resume` attempts recovery before inspecting sources.
- An accepted push or deployment may need reconciliation through `resume`, because cancelling the local wait does not undo the remote effect.

## 0.3.0 (2026-11-07)

- Node 24.x (`>=24 <25`) becomes the qualified version; `.nvmrc` selects the 24 family. Node 22 is no longer qualified.
- A managed command timeout ends its whole process group with `SIGKILL`, including descendants that stayed in the group.
- Earlier catalogs, links and records are preserved. Resuming operations created before this update requires their original executor and was not validated.
- The launcher build runs `npm rebuild --ignore-scripts enois-preview` after compilation to create the npm CLI link. Installation scripts stay disabled.

## 0.2.0 (2026-11-07)

- Automation migrated to strict TypeScript and ESM. Python is no longer required.
- Configuration, data, journals, provenance and catalog use `format: "enois-preview-ts-v1"`. Records with historical `schema` fields or without this `format` are refused before any mutation; start a fresh installation and catalog.
- The default installation is `~/.config/enois-preview-ts`.

### Observed version 0.2.0 walkthrough

On 7 November 2026, the tutorial was exercised on the existing infrastructure with public tool `a95d9862bea0b5076b311600d6f0ebec939cfbd5`, without billing or secret changes. These temporary previews automatically boot another environment after inactivity deletion.

| Step | Validated public revision | Data |
| --- | --- | --- |
| First publication and frozen resume | [997ebbd9399555cf](https://enois-demo-launcher.renan-andradefranca.workers.dev/preview/exemplo-typescript-en-997ebbd9399555cf) | D1, including six additional frozen MIME fixtures |
| Code update | [c1679b51e8c5b536](https://enois-demo-launcher.renan-andradefranca.workers.dev/preview/exemplo-typescript-en-c1679b51e8c5b536) | Same D1, with live H2/media unavailable for the command |
| Explicit refresh | [a6ed69fba999af5c](https://enois-demo-launcher.renan-andradefranca.workers.dev/preview/exemplo-typescript-en-a6ed69fba999af5c) | D2, same three code commits as the previous step |

The initial configuration push failed when the native Git HTTPS transport received signal 11. Its cause is unknown. Canonical resume completed the same revision with all three fictional repositories and live data unavailable, preserving frozen inputs and the confirmed image. Independent public HTML/post/media checks distinguish the new code with D1 from explicit D2; [receipts and limits](../../VALIDATION.md) also include six MIME/byte/hash and Chromium 64x64 checks at desktop 1280 and 390 mobile emulation. The prepared example still has nine SVG assets; six operator supplied frozen fixtures bring this initial published snapshot to 15, and the D2 marker brings refresh to 16.
