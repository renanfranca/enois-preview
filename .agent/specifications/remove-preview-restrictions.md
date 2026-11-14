# Remove preview restrictions (0.4.0)

## Status

- **Status:** approved, not implemented.
- **Source:** requirements agreed in conversation on 2026-11-13, after the 0.3.9 release attempt.
- **Base:** `main` at `b41202c`. Commits `f42003a` and `b41202c` carry the 0.3.9 changes, but no `v0.3.9` tag or GitHub release exists.
- **Target version:** 0.4.0. It absorbs the unreleased 0.3.9 entries. `v0.3.9` MUST NOT be tagged, because `b41202c` cannot publish a real database whose migrations are out of order.

## Purpose

Every recent release existed only to follow changes in the Énóis applications, and none of them protected anyone:

- 0.3.1 to 0.3.7 mostly hardened the stop, copy and restore cycle of the local backend around H2 capture.
- 0.3.8 accepted new columns that stopped the sanitizer with `Unrecognized authentication or integration column`.
- 0.3.9 had to follow a backend constructor change in `MediaMetadataSanitizer`, a backend test that uploads 41 MiB against the demo's 20 MiB ceiling, and failing frontend tests on `qa`.
- Even then, publishing issue 806 failed with `Detected resolved migration not applied to database: 277`. The frozen H2 database had `V287` but not `V277`, and the demo profile did not accept migrations out of order.

The operator owns the local, disposable H2 database and the applications they publish. The tool MUST stop enforcing policy on them. It MUST keep only what makes the published application work and what lets the tool know what it published.

**Observable success:** an operator publishes a scenario from current application commits and a real local database without editing this repository, repinning the launcher, stopping their backend or answering interactive prompts. Every relaxed check still reports what it observed, as a warning.

## Principle: gates and warnings

A **gate** stops the operation. A **warning** never stops it.

- Gates are limited to:
  - failures that prevent building or running the application;
  - failures that prevent the tool from identifying the revision it built and published;
  - the selected accounts not being able to log in.
- Every other check listed in this document MUST become a warning.
- Each warning MUST appear:
  - in a `warnings` array of the final JSON result of `publish`, `resume`, `setup` and `source-digest`, as `{ "code": string, "message": string }`, with a stable `code` in kebab case;
  - as one line on stderr, prefixed `warning:`, when it is emitted.
- Warnings MUST NOT contain secrets, credentials, database values or absolute paths beyond those the operator configured.
- `warnings` is always present. It is empty when nothing was observed.

## Scope

### 1. Image build

**Remove the application test runs from the image build.** The applications' own CI owns their tests.

- The design system stage MUST run its build and pack, without `test:dist`.
- The frontend stage MUST build without `typecheck` and without `npm test`.
- The backend stage MUST package with tests skipped (`-DskipTests package`) and MUST NOT run any test.
- `recipe/test/` and the mechanism that copies Java tests into the backend MUST be removed.

**Remove restriction patches.** The recipe MUST NOT apply any of these changes to application sources:

- `StrictMediaSanitizer` and its copy into the backend;
- the `MediaService` media size change;
- both `MediaStorageProxyController` changes: the reservation and `MEDIA_TYPE_MISMATCH`, and the `MEDIA_SIZE_MISMATCH` read;
- the `EmailService` change. Outgoing mail stays disabled only through `spring.mail.*` in `application-demo.properties`;
- `SIGNUP_OPEN` in the frontend. Signup stays disabled only through `rede.auth.signup-enabled=false`;
- the four `entrar.tsx` changes (`demoReady`, `data-demo-ready`, `aria-busy`, `method="post"`);
- the `navigator` stub in `api-client.legacy.test.ts`.

The JVM property `enois.preview.demo` MUST disappear, both from the recipe and from `runtime/start.ts`.

**Keep only functional adaptations.** They are what lets the application run in a Codespace without S3, a CDN or SMTP:

- `DemoLocalStore` and `DemoStorageConfig`;
- `@Profile("!demo")` on `DevMediaStorageGateway` and `DevStorageUrlFactory`;
- the same origin media prefixes in `src/lib/api/media.ts`, with the generated `demo-media.test.ts`. Its removal is optional, since frontend tests no longer run in the build;
- the public origin in `src/lib/api/client-origin.ts`;
- the design system dependency rewrite to the freshly built package.

A missing anchor in a kept adaptation MUST still fail with `Demo recipe does not support the captured source contract: <file>`, because without it the application does not work.

**Accept migration drift.** `application-demo.properties` MUST set:

- `spring.flyway.out-of-order=true`;
- `spring.flyway.validate-on-migrate=false`.

This matches the backend's `qa`, `hml` and `prd` profiles. Out of order migrations then run at the first boot of each Codespace.

### 2. Data capture

**Remove backend service orchestration.** Capture MUST NOT stop, start, signal or wait for the operator's backend. These go away:

- the `service` configuration block and its commands (`status`, `identity`, `stop`, `start`, `ready`, `released`);
- `expectedIdentity`;
- `restoration.json` and its recovery;
- the `fuser` check.

Capture copies the configured H2 file to private state.

- **Warnings:**
  - the file appears in use, either because `fuser` is available and reports it or because `rede.lock.db` exists next to it;
  - the file changed during the copy. The copy is still used, and a damaged copy surfaces as a build or validation failure.
- The process lease that serializes two captures of the same file within this tool MAY stay.
- `preview/service.ts`, the example's owned backend adapter, MAY remain as an example helper. No core command may depend on it.

**Sanitizer (`recipe/SeedTool.java`):**

- An unrecognized column matching the credential pattern MUST produce a warning naming `TABLE.COLUMN` and MUST NOT stop capture.
- Emptying the listed tables stays best effort: an absent table is skipped silently.
- These stay, because login depends on them:
  - disabling every password;
  - rewriting every email to a disposable address;
  - setting the selected accounts' login emails.
- `sanitizerSha256` changes, so the next capture does not reuse data frozen by earlier versions.

**Source repositories:**

- A dirty working tree MUST produce a warning stating that only the committed `HEAD` is published.
- It MUST NOT stop publication.

**Accounts:**

- At least one account MUST be selected. The upper bound of 20 is removed.
- `email` becomes optional per account.
- When the email is absent, the tool MUST generate a unique disposable login (`account<N>@enois.invalid`).
- When it is present, any syntactically valid email that is unique in the selection is accepted.
- `id` and `label` keep their current rules.
- `publish` gains `--accounts ID[,ID...]`. Labels come from the captured listing, and unknown IDs fail.
- Interactive selection remains available in a terminal. Without a terminal and without accounts, publication fails with a message naming `--accounts`.

**Storage:** insufficient free space for the capture is a warning.

**`source-digest`:** it MUST work on the configured file whether or not a backend uses it, emitting the in use warning when applicable.

### 3. Tool identity, launcher and lease

**Tool commit:**

- `toolCommit` MUST NOT be required in the configuration and MUST NOT be part of the revision identity.
- The recorded `recipe`, `runtime`, `src` and `dist` inventories already identify what was built.
- The journal and the final result MUST record the commit of the running tool, or `null` when it cannot be determined.

**Unverified tools:**

- A tool that is not a verified installation, such as a development checkout, MAY publish and resume.
- It MUST produce a warning.

**Launcher pin:**

- A launcher whose `tool.lock.json` or `enois-preview` dependency differs from the running tool MUST produce a warning naming both commits.
- The launcher MUST NOT be repinned automatically.
- The checks that `wrangler.jsonc` names the configured repository and that the launcher is the configured repository stay gates.

**Launcher deployment:** it runs `npm ci --ignore-scripts` and `npm run build` only, without `npm test` and without `npm run check`.

**Remote lease:**

- The lease stays.
- `publish` and `resume` gain `--force-lease`, which deletes an existing lease owned by another operation and records that in the journal and in `warnings`.
- Without the flag, the current waiting and refusal behavior is unchanged.

**Configuration compatibility:**

- The `format` stays `enois-preview-ts-v1`.
- A 0.3.x configuration MUST load. `service`, `toolCommit`, `installation` and other fields no longer used are ignored with one warning listing them.
- Revisions created by 0.3.x have no guaranteed `resume`. A new `publish` creates a new revision.

### 4. Setup and validation

**Setup:**

- The free plan confirmation becomes a printed warning.
- The `installation` record is no longer written or required.
- `publish` MUST NOT require a prior interactive `setup` confirmation.

**Prerequisites:**

- `fuser` is no longer required.
- A launcher repository or GHCR package that is not private produces a warning.
- Commands still required MUST still fail when missing, because building or publishing needs them.

**Validation gates, local and public:**

1. readiness reports `UP`;
2. the running image and the public configuration report the expected revision identity;
3. each selected account logs in and `/api/me` returns its ID.

**Validation warnings:** these checks still run, and their results go to the validation record and to `warnings`:

- byte count, hash and MIME of frozen media;
- image decoding in Chromium at both widths. When Chromium is unavailable, decoding is skipped with a warning;
- permissions that differ from the frozen record;
- missing secure session cookies;
- external read observations;
- in `verifyImage`: license notices, the seed and media inventory in the image, and the design system resolution.

**Worker registration:** a Codespace whose machine does not report exactly 2 CPUs MUST be registered and logged, not refused.

### 5. Public link

**Gateway:**

- `runtime/gateway.ts` MUST NOT block application routes. `demoBlocked` and its route list are removed.
- `/__demo/` paths stay reserved for the tool. A path containing `;` keeps being refused.
- Visitors share accounts. A visitor can change a shared account's password and lock others out until the Codespace recycles after idle time. This is accepted.

**Upload size:**

- One per file limit MUST apply consistently in the Worker's `forwardUpload`, the runtime `upload-transport` and `DemoLocalStore`.
- The limit is 100 MB, the request body ceiling of the Cloudflare free plan. The implementation MUST confirm that ceiling against current Cloudflare documentation and use the confirmed value.
- The backend's own media ceiling applies unchanged.
- The 256 MiB shared capacity limit is removed. Codespace disk is the limit, and a full disk surfaces as the backend's own write error.
- The 8 MiB transport parts stay, because Codespaces port forwarding accepts at most 16 MB per request.

### 6. Repository process

**Example:**

- `test:example` MUST assert row counts and MUST NOT assert `canonicalDataSha256`.
- `example/sources.json` keeps fixed pins, which the maintainer moves to current `qa` heads when convenient.
- `test:image` and `test:media` MUST drop the assertions on removed behavior, such as strict sanitizer refusals and the 20 MiB refusal. They MAY add the acceptance scenarios below.

**Releases:**

- A release is a tag and a short changelog entry.
- No new `VALIDATION.md` section, `docs/validation/*/local.json` or release evidence bundle is required.
- Existing sections and files stay untouched.

**Changelog:** the 0.4.0 entry replaces the unreleased 0.3.9 heading, keeps the still true 0.3.9 items (installer, `install` command), and states every behavior change in this document.

**Guides:** README, tutorial, recipes, concepts and flow, in both languages, MUST describe the new behavior. Recipes MUST remove remedies for refusals that no longer exist.

## Unchanged behavior

- Capture still freezes data and media into private state, and revisions stay content addressed by their inputs.
- Credentials are still rotated per Codespace boot. They are never printed, and they are served only through the credentials page.
- The Worker still owns Codespace lifecycle, idle deletion after 10 minutes and the private port token.
- Publication still stops before any remote effect when the local build or the local validation gates fail.
- The one command installer and `enois-preview install` keep working.

## Acceptance scenarios

1. **Issue 806 publishes.**
   - Given: the issue 806 workspace (backend `a3a6da97`, frontend `595914bd`, design system `68f08d0`) and its frozen database, where `V277` is out of order relative to `V287`.
   - When: `enois-preview publish issue-806-precos-longos` runs with the 0.4.0 tool.
   - Then: it ends with `status: "validated"`, the backend boots without a Flyway error, and no launcher repin was needed beforehand.
2. **Credential column warns.**
   - Given: a database with an extra column named `EXAMPLE_TOKEN` in a table that is not dropped.
   - Then: capture completes, and `warnings` names that column.
3. **Running backend warns.**
   - Given: the source backend is running on the configured H2 file and the configuration has no `service` block.
   - Then: capture does not stop the backend, emits the in use warning, and publication proceeds.
4. **Old configuration loads.**
   - Given: a 0.3.9 configuration with `service`, `toolCommit` and `installation`.
   - Then: `publish` runs, warns once about the ignored fields, and does not require `setup`.
5. **Large upload works.** On the public link, a logged in visitor uploads a valid 50 MB audio file and it is stored.
6. **Formerly blocked route reaches the backend.** A request to a route `demoBlocked` used to refuse, such as `/api/support/...`, receives the backend's response instead of the gateway's `403`.
7. **Application tests are not run.** The `build.log` of a publication shows no backend, frontend or design system test execution, and the image builds from a backend whose own test suite fails.
8. **Unattended selection works.** Without a terminal, `publish SCENARIO --accounts A,B` selects accounts A and B with generated logins.
9. **Lease override works.**
   - Given: a lease owned by another operation.
   - Then: `--force-lease` removes it, records the takeover in the journal, and continues.

The repository's `npm test` and the affected integration suites MUST pass after their assertions are updated to this contract.

## Rejected alternatives and limits

- **A `preview` profile inside the Énóis applications.** Local media storage and same origin media owned upstream would remove the remaining adaptations. It is the long term fix for source coupling, but it belongs to another repository and another issue.
- **Automatic launcher repin.** This is rejected for now. A pin mismatch only matters when the Worker and runtime contract changes, which is rare. The warning is enough.
- **Tagging `v0.3.9` at `b41202c`.** Rejected, because that commit cannot publish issue 806.
- **Keeping the backend test suite in the build, with demo restrictions behind a JVM flag** (the 0.3.9 approach). Rejected: it adds about 15 minutes per publication and still breaks whenever an application test meets a demo difference.
- **Keeping strict media refusals, with application tests skipped by name.** Rejected: it needs edits here each time the backend adds such a test.
- **Hard limits that remain:**
  - Codespaces port forwarding at 16 MB per request;
  - the Cloudflare free plan request body ceiling;
  - free plan availability.
  The tool works within them. It cannot remove them.
