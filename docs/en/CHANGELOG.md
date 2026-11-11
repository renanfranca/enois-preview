# Release history

[Português do Brasil](../../CHANGELOG.md) · [README](README.md)

This file records what changed in each release, newest first. The guides ([README](README.md), [tutorial](TUTORIAL.md), [recipes](RECIPES.md)) describe current behavior only. Each release's evidence is in [VALIDATION.md](../../VALIDATION.md).

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
