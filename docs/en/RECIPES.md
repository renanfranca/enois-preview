# Recipes

[Português do Brasil](../pt-BR/RECIPES.md) · [README](README.md) · [Concepts](CONCEPTS.md) · [Flow](FLOW.md) · [Tutorial](TUTORIAL.md)

Every recipe has the same shape: **When to use**, **Commands**, **What to expect** and **If it goes wrong**. Run everything in your local terminal, never inside a Codespace. When the CLI fails, the message starts with `Publication incomplete:` (or `Source digest incomplete:` for `source-digest`) followed by the reason; search this page for the reason.

## 1. Install or switch the tool to another pinned commit

**When to use:** on the first installation, or when the launcher starts pinning another public commit in `tool.lock.json`.

**Commands:**

On the first installation, with Node 24.x, npm, `curl` and `tar`:

```sh
COMMIT=<PINNED_PUBLIC_COMMIT>
curl -fsSL "https://raw.githubusercontent.com/renanfranca/enois-preview/$COMMIT/install.sh" | bash -s -- "$COMMIT"
```

With the tool already installed, to switch to another pinned commit:

```sh
enois-preview install <PINNED_PUBLIC_COMMIT>
```

Both paths create the same verified installation and install the Chromium used by public validation. `install.sh` comes from the pinned commit itself and only prepares the installer in a temporary directory, removed at the end.

After switching commits, the configuration needs no change. If the launcher pins another commit in `tool.lock.json` or in the `enois-preview` dependency of its `package.json`, publication continues with the `launcher-pin` warning, which names both commits. The launcher is never repinned automatically: repin it when you want its Worker to use this version; see [installation diagnostics](../diagnostics/installation.en.md).

Manual path, for a commit earlier than 0.3.9 (which has no `install.sh` and does not install Chromium by itself) or if you prefer not to run a downloaded script:

```sh
git clone https://github.com/renanfranca/enois-preview.git /absolute/temporary/enois-preview
cd /absolute/temporary/enois-preview
git checkout --detach <PINNED_PUBLIC_COMMIT>
npm ci --ignore-scripts
npm run build
node dist/scripts/install-tool.js --commit <PINNED_PUBLIC_COMMIT>
(cd ~/.local/share/enois-preview/current && npx --no-install playwright install chromium)
```

**What to expect:** the installer prints JSON with `commit`, `installation` (`~/.local/share/enois-preview/<COMMIT>`), `current`, `stamp` (the `install.json`), `linked: true` and `browser: true`. The `enois-preview` command now points at that installation.

Attention:
- Installations are immutable. Do not run `npm run` or edit files inside one: it rebuilds `dist`, and `publish` then reports the `unverified-tool` warning.
- A development checkout can publish too, with the `unverified-tool` warning; the journal records its Git `HEAD`.
- Authenticate with `gh auth login` and your Docker credential mechanism. Never put tokens in arguments, chats or versioned files.
- Interrupting with Ctrl+C before the installation exists leaves nothing behind, and the command can be repeated. Interrupting while Chromium downloads leaves the installation complete; run the command the message shows.

**If it goes wrong:**
- `is already installed at ...; installations are immutable.`: that commit is already installed. The installer does not overwrite it or switch `current` in this case.
- `Download of ... failed (HTTP ...)` or `Download of commit ... failed`: check that the full SHA exists in the public repository. If the `install.sh` `curl` answers 404, the commit is earlier than 0.3.9: use the manual path.
- `Download of ... failed; check the network connection and retry.`: the machine did not reach `codeload.github.com`. Check the network or the proxy and repeat. Nothing was installed.
- `Chromium, used by the public validation, was not installed`: the installation is complete, only the browser is missing. Run the command the message shows.
- `Node 24.x is required`: select Node 24, for example with `nvm install 24`, and repeat.
- `Build changed source files outside dist`: the commit cannot be installed; tell whoever pinned it.
- Anything else: [diagnostics](../diagnostics/README.md).

## 2. First publication with the fictional example

**When to use:** to get to know the tool, or to validate your infrastructure without real data.

**Commands:**

```sh
node ~/.local/share/enois-preview/current/dist/example/prepare.js /absolute/new/fictional-workspace
# edit /absolute/new/fictional-workspace/.preview/config.json with your infrastructure
enois-preview setup --config /absolute/new/fictional-workspace/.preview/config.json
enois-preview publish my-scenario
```

**What to expect:** preparation clones the three applications at the commits in [example/sources.json](../../example/sources.json), creates a new H2 with fictional data only, and writes a configuration with the accounts Lia (`example_lia`) and Rui (`example_rui`). `publish` ends with JSON containing `status: "validated"` and the `url`. The full walkthrough is in the [tutorial](TUTORIAL.md).

**If it goes wrong:** `Example destination must not exist.` asks for a new path. For infrastructure failures, see [installation diagnostics](../diagnostics/installation.en.md).

## 3. Publish again with new code only

**When to use:** you made new commits in the applications and want the same scenario with the same data.

**Commands:**

```sh
# in all three applications: commit what you want to show; only the committed HEAD is published
enois-preview publish my-scenario
```

**What to expect:** the CLI does not read the local database; it works even with H2 unavailable. The final JSON has `dataReused: true`, a new `revision` and a new `url`. Update the link in the pull request (PR) by hand. If no commit changed, the revision is the same and the JSON has `reused: true`.

**If it goes wrong:** a `source-dirty` warning means uncommitted changes were left out; commit them and publish again. A remote stage failure: see [recipe 5](#5-resume-a-failed-publication). Other warnings: see [recipe 10](#10-common-errors-and-what-to-do).

## 4. Publish with new data

**When to use:** you want to show data or media that changed in your local database.

**Commands:**

```sh
enois-preview publish my-scenario --refresh-data
```

**What to expect:** the CLI copies H2 and media while your backend keeps running, then sanitizes the copy. If the backend holds the file or writes during the copy, the result carries `database-in-use` or `database-changed-during-copy`; the copy is still used. For a fully consistent copy, stop the backend yourself first. The final JSON has `dataReused: false`. If the sanitized data equals the previous version, that data version is reused. Earlier versions stay available.

**If it goes wrong:**
- `Selected identity missing in refreshed data.`: a selected account no longer exists in the database. Fix `accounts` in the configuration (and repeat `setup`) or pass `--accounts`, then refresh again. The previous complete data stays in effect.
- `Capture incomplete. <reason> Previous complete data preserved; retry publication explicitly.`: capture replaced nothing. Fix the reason and repeat.
- A copy damaged by concurrent writes shows up later as a build or validation failure. Stop the backend and refresh again.

## 5. Resume a failed publication

**When to use:** `publish` failed after freezing the revision. The message looks like: `Stage <stage> incomplete: <reason> Revision <revision>. Run enois-preview resume <revision>.`

**Commands:**

```sh
enois-preview resume <full-revision>
```

**What to expect:** `resume` uses the recorded commits and data, checks the frozen files, reconciles what was already accepted remotely and continues from the pending stages. It ends with the same JSON as `publish`. It works even with the applications and H2 unavailable, because it never recaptures data.

Attention:
- Do not edit the catalog or push by hand to complete the revision.
- Revisions frozen by 0.3.1 or earlier resume only with their original executor: a clean checkout at their commit, built with `npm run build`.

**If it goes wrong:**
- `Resume requires the full 64 character revision ID.`: copy the whole revision from the failure message.
- `Unknown revision. Resume never recaptures live data.`: that revision does not exist in this `state`.
- `Another remote publication still holds the lease. Retry with resume after its owner reconciles; do not delete an ambiguous lease.`: another operation may be alive. Wait and run `resume` again. If you are sure that operation is dead, `enois-preview resume <full-revision> --force-lease` deletes its lease, records the takeover in the journal and continues with the `lease-forced` warning.
- `Registry push outcome is unresolved.` or `Deployment outcome unresolved; inspect Cloudflare deployments and resume after reconciliation.`: the remote result is ambiguous. Inspect the destination before retrying; see [diagnostics](../diagnostics/README.md).

## 6. Ctrl+C, SIGTERM or a killed process

**When to use:** you interrupted a command, or the process was ended midway.

**Commands:**

```sh
# after Ctrl+C or SIGTERM, wait for the command to finish by itself
echo $?    # 130 for Ctrl+C (SIGINT), 143 for SIGTERM
# if a revision was already frozen:
enois-preview resume <full-revision>
# if it was not, repeat the same publish:
enois-preview publish my-scenario
```

**What to expect:** the first `Ctrl+C` or `SIGTERM` cancels active commands and prevents later stages. Capture never stops your backend, so there is nothing to restore. An incomplete capture keeps the previous complete data.

Attention:
- An accepted push or deployment may need reconciliation: cancelling the local wait does not undo the remote effect. Use `resume` with the reported revision.
- If the interrupted operation left its remote lease behind and you are sure it is no longer running, add `--force-lease` to `resume` (see [Lease](CONCEPTS.md#lease)). Never force a lease that may belong to a live operation.
- `SIGKILL` leaves no chance to clean up; the next run continues from the journal.

**If it goes wrong:** see [diagnostics](../diagnostics/README.md).

## 7. Check whether the database changed

**When to use:** you want to know whether the source database's data changed, for example before and after a manual test in your local application.

**Commands:**

```sh
enois-preview source-digest
```

**What to expect:** JSON with `databaseSha256`, `logicalSha256`, per table row counts and `warnings`. The command is read only: it copies H2 into a private directory, computes the digest and deletes the copy. It never starts or stops the backend, works while the backend runs and does not require the verified installation. If the file appears in use, the result carries the `database-in-use` warning: data the backend has not written to disk yet is missing from the digest. For a digest you can compare, stop the backend first; in the fictional example, `node ~/.local/share/enois-preview/current/dist/preview/service.js /absolute/new/fictional-workspace/.preview/service.json stop` does that. Compare `logicalSha256` (the H2 `SCRIPT` without `CREATE USER` lines, hashed with sha256), not `databaseSha256`: a `start` and `stop` rewrites the file without changing data.

**If it goes wrong:**
- `Configuration missing. Run enois-preview setup --config PRIVATE_JSON first.`: run `setup` first.

## 8. Use my own data

**When to use:** you want to publish with your own H2 database and media, not the fictional example.

Attention: all content of the configured database and media is visible to whoever opens the link. Use only your own data or fictional data; the full rule is in [Show in the PR that the problem is fixed](#9-show-in-the-pr-that-the-problem-is-fixed).

**Commands:** edit the private configuration file and repeat setup.

```json
{
  "database": "/absolute/path/rede.mv.db",
  "h2Jar": "/absolute/path/h2-<version>.jar",
  "media": [{ "root": "/absolute/path/media", "url": "/prefix/" }],
  "accounts": [{ "id": "STABLE_ID", "email": "account@enois.invalid", "label": "Visible name" }]
}
```

```sh
enois-preview setup --config /absolute/path/config.json
```

**What to expect:** setup checks commands, repositories, the H2 driver, the database, the launcher and GHCR, and ends with JSON carrying `warnings`. A launcher repository or GHCR package that is not private, low free disk space (`storage-low`) and the Free plan reminder (`free-plan`) are warnings. Fields from 0.3.x such as `service`, `toolCommit` and `installation` are ignored and preserved, with one `ignored-config-fields` warning. Rules for each field:
- Every path is absolute. `state` lives outside the application repositories.
- The `h2Jar` driver must match the configured database.
- `media` prefixes start and end with `/` and do not overlap.
- `accounts` needs at least one account, with no upper bound. `id` and `label` are required.
- `email` is optional. When present, it must be a valid address, unique in the selection; it becomes the login shown on the link's entry page and is written into the `USER_CREDENTIALS` and `USERS` tables of the H2 copy. Prefer an invented address in `@enois.invalid`, never the person's real email: `.invalid` is a reserved domain (RFC 2606 and RFC 6761) that never resolves, so no email sent by the demo reaches a person. When `email` is absent, the tool generates `account<N>@enois.invalid`. Accounts that are not selected get `<id>@disabled.enois.invalid` and no login.
- If `accounts` is empty, pass `enois-preview publish <scenario> --accounts ID[,ID...]`, or let the first `publish` list the identities in the captured database and ask in the terminal. Labels come from the captured listing, and an unknown ID fails. Without a terminal and without accounts, the message names `--accounts`.

**If it goes wrong:** `Accounts require a stable id and a label.` means an account lacks one of them. `Account emails must be valid addresses.` means an `email` is malformed. `Select distinct accounts and demo logins.` means two accounts share an ID or an email. `Unknown account ID ...; use an ID from the captured listing.` means an ID passed in `--accounts` is not in the captured database.

<a id="9-share-the-link-in-the-pr"></a>
## 9. Show in the PR that the problem is fixed

**When to use:** you fixed something and want reviewers to see the fix running, without relying on screenshots or videos. With the link, reviewers open the change in a real environment and explore it however they prefer.

**Attention: the link is public.** The Énóis repositories are public, and so is the link pasted into the PR. Before publishing, know what becomes exposed:
- All content of the local H2 database and of the captured media is visible to whoever opens the link, not only what the PR shows.
- The selected accounts become shared accounts, with their passwords shown on the link's entry page. Other accounts keep their profiles and content visible, with login disabled.
- Sanitization removes sessions, tokens and passwords, but does not anonymize content.

So choose the data in this order:
1. **Fictional data shaped like the real case:** reproduce the shape that causes the problem (text length, number of items, emojis, image dimensions, states such as "pinned" or "with badges", screen width), not the real content.
2. **Your own data**, knowing it is exposed to whoever opens the link.
3. **Other people's content, including content copied from Énóis: do not use it**, unless they consent or the Énóis team approves.

**Commands:**
1. Answer: what makes the problem reproducible? Create that fictional data in your local application, through its own interface. Examples: a pinned post in a community with a long name, seen on a narrow screen; a profile with the About, Projects and Posts sections filled in.
2. Publish with that data: `enois-preview publish <scenario> --refresh-data` ([Publish with new data](#4-publish-with-new-data)). Accounts with login come from `accounts` in the configuration ([Use my own data](#8-use-my-own-data)). With an empty `accounts`, only a scenario's first `publish` asks which accounts to use, and a refresh reuses those from the previous capture. If the fictional accounts are new, pass `--accounts` with their IDs: a selection that differs from the frozen data captures again.
3. When the command ends with `status: "validated"`, open the `url` from the final JSON and test the PR's behavior yourself.
4. Paste the block below into the PR, filled in:

```markdown
## How to verify

Preview: <url from the final JSON>
Accounts and passwords: on the link's entry page (they change on every boot).

1. Sign in as <account>.
2. Open <page> and <action>.
3. Expected: <result>. Check on a phone and on a desktop, or on your own device.

Fictional data, built to reproduce <characteristic of the case>.
<!-- Optional: a screenshot of the "after" state. The link remains the main evidence. -->
```

**What to expect:** whoever opens the link sees a waiting page while the Codespace boots by itself; nobody needs to open its terminal. Then the page with the accounts and passwords appears; passwords are generated on every boot. Reviewers can open the link on their own phone, a real device rather than an emulation.

Attention:
- Accounts, data and disk are shared by all visitors. Use independent sessions for author and reader. A visitor can change a shared account's password and lock others out until the environment recycles; this is accepted.
- Each uploaded file is limited to 100 MB, the Cloudflare free plan request body ceiling, and the backend's own media limits still apply. The total is limited only by the Codespace disk; a full disk shows up as the backend's own write error.
- A new boot discards changes and uploads, restores the seed and rotates passwords.
- Public signup stays disabled through `rede.auth.signup-enabled=false` and outgoing mail through `spring.mail.*`. Other application routes are not blocked; only `/__demo/` paths and paths containing `;` are refused.
- Deletion starts after ten minutes without recognized interaction. The waiting page, including its status polling, and credential reads do not renew the deadline. Platform availability and quotas limit this protection.
- The link is immutable, but the environment is not permanent. A new revision produces another link, which you update in the PR by hand.
- The environment boots only while your infrastructure and the free quotas keep existing. An optional screenshot of the "after" state serves as a durable record; it goes with the link and never replaces it.

**If it goes wrong:** a page saying GitHub refused the creation (`O GitHub recusou a criação.`) asks you to wait ten minutes and try again, without changing machine or plan. If the environment does not start, see [diagnostics](../diagnostics/README.md).

## 10. Common errors and what to do

**When to use:** the CLI stopped the command, or the final JSON carries warnings you want to understand.

**Commands:** depending on the error or warning, below.

**What to expect:** after the fix, the same command proceeds normally. A warning never stops a command.

**If it goes wrong:**

| Message | What to do |
| --- | --- |
| `Unsupported record format. Expected enois-preview-ts-v1.` | The file comes from an older version. Preserve the old files and create a fresh installation with `--home NEW_DIRECTORY`. |
| `Configuration missing. Run enois-preview setup --config PRIVATE_JSON first.` | Run `setup` first. |
| `Revision ... was created by an earlier enois-preview version and cannot be resumed by this version. ...` | `resume` received a revision whose journal records `inputs.toolCommit`, the 0.3.x format. The journal is intact; it only belongs to another version. Run `enois-preview publish SCENARIO` to create a new revision, or resume it with the version that created it. |
| `Select stable account IDs with enois-preview publish SCENARIO --accounts ID[,ID...], ...` | No accounts are configured and there is no terminal to ask. Pass `--accounts` (recipe 8). |
| `Stage localImage incomplete: docker failed (exit 1); …` | An application does not build at the published commits. Read the operation's `build.log`. Nothing remote was changed. |
| `Stage publicValidation incomplete: ...` with `Readiness is not UP`, `input identity mismatch` or `HTTP 401` | The app did not start, runs another revision, or a selected account cannot log in. These are the only validation failures. See [diagnostics](../diagnostics/README.md). |
| Node outside `>=24 <25` | The tool does not check the Node version and has no message of its own for it. Check with `node --version` and use `nvm install` and `nvm use`, which read `.nvmrc`. |

Warnings, in `warnings: [{code, message}]` and on stderr as `warning: <message>`:

| Code | Meaning | What to do |
| --- | --- | --- |
| `source-dirty` | An application has staged, unstaged or untracked changes; only its committed `HEAD` was published. | Commit what you want to show and publish again. |
| `database-in-use`, `database-changed-during-copy`, `media-changed-during-copy` | The backend held or changed the files during capture. The copy was used. | If the build or validation fails, stop the backend and refresh. |
| `credential-column` | The database has a credential-like column this version does not know, named as `TABLE.COLUMN`. Its values were kept. | Check what that column holds before sharing the link. |
| `storage-low` | Little free disk space for the capture. | Free space if the capture fails. |
| `unverified-tool` | The tool is not a verified installation (for example, a development checkout). | Install a pinned commit (recipe 1) if you need a verified record. |
| `launcher-pin` | The launcher pins another tool commit. | Repin the launcher when you want its Worker on this version. |
| `lease-forced` | `--force-lease` deleted another operation's remote lease. | Make sure that operation is not running. |
| `ignored-config-fields` | The configuration has fields no longer used, such as `service`, `toolCommit` or `installation`. | Remove them when convenient; they are preserved meanwhile. |
| `free-plan`, `launcher-not-private`, `registry-not-private` | Reminders from `setup` about plans and visibility. | Keep both accounts on Free plans with spending blocked, and keep the launcher and the package private. |
| `permissions-differ`, `session-cookies-missing`, `media-*`, `image-*`, `external-reads` | A validation check differed from the frozen record. The link was still validated. | Open the link and check the affected screens. |
