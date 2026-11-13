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

After switching commits, put the same SHA in `toolCommit` in your private configuration file and repeat `enois-preview setup --config <file>`. The launcher must also pin that commit in `tool.lock.json` and in the `enois-preview` dependency of its `package.json`; see [installation diagnostics](../diagnostics/installation.en.md).

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
- Installations are immutable. Do not run `npm run` or edit files inside one: it rebuilds `dist` and `publish` then refuses the installation.
- A development checkout cannot publish, even when clean at the same commit.
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
# in all three applications: commit your changes and leave a clean tree
enois-preview publish my-scenario
```

**What to expect:** the CLI neither reads nor stops the local database; it works even with H2 unavailable. The final JSON has `dataReused: true`, a new `revision` and a new `url`. Update the link in the pull request (PR) by hand. If no commit changed, the revision is the same and the JSON has `reused: true`.

**If it goes wrong:** dirty tree or refused installation: see [recipe 10](#10-common-errors-and-what-to-do). A remote stage failure: see [recipe 5](#5-resume-a-failed-publication).

## 4. Publish with new data

**When to use:** you want to show data or media that changed in your local database.

**Commands:**

```sh
enois-preview publish my-scenario --refresh-data
```

**What to expect:** the CLI stops the backend (only if it was running), copies H2 and media, returns the backend to its previous state and sanitizes the copy. The final JSON has `dataReused: false`. If the sanitized data equals the previous version, that data version is reused. Earlier versions stay available.

**If it goes wrong:**
- `Selected identity missing in refreshed data.`: a selected account no longer exists in the database. Fix `accounts` in the configuration, repeat `setup` and refresh again. The previous complete data stays in effect.
- `Capture incomplete; backend restored to its prior state.` or `Capture incomplete; backend restoration pending.`: capture replaced nothing. If restoration is pending, see [recipe 6](#6-ctrlc-sigterm-or-a-killed-process).
- `H2 is in use or cannot be checked. No lock file was removed.`: some process still uses the database file. Do not delete H2 lock files.

## 5. Resume a failed publication

**When to use:** `publish` failed after freezing the revision. The message looks like: `Stage <stage> incomplete: <reason> Backend restoration complete. Revision <revision>. Run enois-preview resume <revision>.`

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
- `Another remote publication still holds the lease. Retry with resume after its owner reconciles; do not delete an ambiguous lease.`: another operation may be alive. Wait and run `resume` again.
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

**What to expect:** the first `Ctrl+C` or `SIGTERM` cancels active commands and prevents later stages. The CLI still completes backend restoration; further signals do not interrupt it. At the end it reports `Backend restored to its prior state.` or `Backend restoration pending; preserve its record and retry this command.`. An incomplete capture keeps the previous complete data.

Attention:
- If restoration is pending, preserve `<state>/restoration.json`. The next `publish` or `resume` attempts recovery before inspecting sources.
- An accepted push or deployment may need reconciliation: cancelling the local wait does not undo the remote effect. Use `resume` with the reported revision.
- Never remove another operation's lease.
- `SIGKILL` leaves no chance to restore; recovery happens on the next run, from `restoration.json` and the journal.

**If it goes wrong:** `Pending restoration belongs to another service configuration.` means the service configuration changed after capture. Restore the exact configuration recorded in `restoration.json` before retrying. See [diagnostics](../diagnostics/README.md).

## 7. Check whether the database changed

**When to use:** you want to know whether the source database's data changed, for example before and after starting and stopping the backend.

**Commands:**

```sh
# with the source backend stopped and released
enois-preview source-digest
```

In the fictional example, the backend is controlled by the adapter configured in `service`, for example `node ~/.local/share/enois-preview/current/dist/preview/service.js /absolute/new/fictional-workspace/.preview/service.json stop`.

**What to expect:** JSON with `databaseSha256`, `logicalSha256` and per table row counts. The command is read only: it copies H2 into a private directory, computes the digest and deletes the copy. It never starts or stops the backend and does not require the verified installation. Compare `logicalSha256` (the H2 `SCRIPT` without `CREATE USER` lines, hashed with sha256), not `databaseSha256`: a `start` and `stop` rewrites the file without changing data.

**If it goes wrong:**
- `The source backend must be stopped and released; source-digest never stops it. No digest computed.`: stop the backend through your adapter and run it again.
- `Backend restoration pending; run publish or resume to settle it first. No digest computed.`: settle the pending restoration (recipe 6).
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
  "accounts": [{ "id": "STABLE_ID", "email": "account@enois.invalid", "label": "Visible name" }],
  "service": {
    "status": ["command", "arg"], "identity": ["command", "arg"],
    "stop": ["command", "arg"], "start": ["command", "arg"],
    "ready": ["command", "arg"], "released": ["command", "arg"],
    "expectedIdentity": "text that identity must print",
    "timeout": 60
  }
}
```

```sh
enois-preview setup --config /absolute/path/config.json
```

**What to expect:** setup checks commands, repositories, the H2 driver, the database, the launcher, GHCR and the service identity. Rules for each field:
- Every path is absolute. `state` lives outside the application repositories.
- The `h2Jar` driver must match the configured database.
- Each `service` command is an argument array, without shell, with a timeout (60 seconds when `timeout` is missing). `status` prints `running` or `stopped`, `ready` prints `ready` and `released` prints `released`.
- The output of `identity` must equal `expectedIdentity`, which must prove process ownership and the H2 location, never a port alone.
- `media` prefixes start and end with `/` and do not overlap.
- The `email` of each account in `accounts` must have the form `<local part>@enois.invalid`, and the local part accepts only lowercase letters, digits, `.`, `_` and `-`. Use an invented email, never the person's real email: it becomes the login shown on the link's login page. The tool checks this rule when it reads the configuration (during `setup` and in every command that reads the config) and again when it sanitizes the H2 copy, where it writes the email into the `USER_CREDENTIALS` and `USERS` tables. Accounts that are not selected get `<id>@disabled.enois.invalid` and no login. The reason: `.invalid` is a reserved domain (RFC 2606 and RFC 6761) that never resolves, so no email sent by the demo reaches a person, and the login shown on the public link does not expose anyone's real email.
- If `accounts` is empty, the first `publish` lists the identities in the captured database and asks in the terminal which IDs to use. In that case, the tool generates the logins `account1@enois.invalid`, `account2@enois.invalid` and so on.

**If it goes wrong:** `Backend service ownership mismatch; configure its identity and database.` means `identity` did not print `expectedIdentity`. `Configure service.<name> as an argument array.` means a command is missing or malformed. `Accounts require stable id, label and disposable @enois.invalid email.` means an account email has the wrong form: change the account email to `<something>@enois.invalid`.

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
2. Publish with that data: `enois-preview publish <scenario> --refresh-data` ([Publish with new data](#4-publish-with-new-data)). Accounts with login come from `accounts` in the configuration ([Use my own data](#8-use-my-own-data)). With an empty `accounts`, only a scenario's first `publish` asks which accounts to use, and a refresh reuses those from the previous capture. If the fictional accounts are new, put their IDs in `accounts` and repeat `setup`, or publish a new scenario and select the fictional accounts when the terminal asks.
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
- Accounts, data and upload capacity are shared by all visitors. Use independent sessions for author and reader.
- Each environment accepts new files up to 20 MiB and 256 MiB of uploads in total, shared by visitors. Seed media does not count.
- A new boot discards changes and uploads, restores the seed and rotates passwords.
- Public signup and external write integrations stay disabled.
- Deletion starts after ten minutes without recognized interaction. The waiting page, including its status polling, and credential reads do not renew the deadline. Platform availability and quotas limit this protection.
- The link is immutable, but the environment is not permanent. A new revision produces another link, which you update in the PR by hand.
- The environment boots only while your infrastructure and the free quotas keep existing. An optional screenshot of the "after" state serves as a durable record; it goes with the link and never replaces it.

**If it goes wrong:** a page saying GitHub refused the creation (`O GitHub recusou a criação.`) asks you to wait ten minutes and try again, without changing machine or plan. If the environment does not start, see [diagnostics](../diagnostics/README.md).

## 10. Common errors and what to do

**When to use:** the CLI refused the command before any effect.

**Commands:** depending on the error, below.

**What to expect:** after the fix, the same command proceeds normally.

**If it goes wrong:**

| Message | What to do |
| --- | --- |
| `<application> has staged, unstaged or untracked source changes; commit or resolve them before publishing. No service was stopped.` | Commit or discard the changes in that application. The tool does not commit for you. |
| `The verified installation belongs to another public commit; install the configured commit with install-tool before publishing or resuming.` | The configured `toolCommit` differs from the installation in use. Install that commit (recipe 1). |
| `Tool is not a verified installation of a public commit; install the configured commit with install-tool before publishing or resuming.` | The installation was changed (for example, someone ran `npm run` inside it) or the command came from a development checkout. Install the commit again under another prefix or use the correct installation. |
| `Private launcher tool pin differs from the executor. Complete its reviewed TypeScript installation before publication or resume.` | The launcher's `tool.lock.json` pins another commit. Align the launcher with `toolCommit`. |
| `Initial Free plan verification required. Run enois-preview setup --config PRIVATE_JSON in an interactive local terminal.` | Run `setup` in an interactive terminal and confirm the Free plans. |
| `Unsupported record format. Expected enois-preview-ts-v1.` | The file comes from an older version. Preserve the old files and create a fresh installation with `--home NEW_DIRECTORY`. |
| `Unrecognized authentication or integration column: <TABLE>.<COLUMN>; extend the reviewed sanitizer before capture`, written to `<state>/tools/sanitize.log`. The terminal shows `Capture incomplete; backend restored to its prior state. java failed (exit 1)…`. | The database has a credential-like column that this tool version does not know yet. Capture stopped without promoting data, and the backend is back in its prior state. You need a tool version that recognizes that column (recipe 1). |
| Node outside `>=24 <25` | The tool does not check the Node version and has no message of its own for it. Check with `node --version` and use `nvm install` and `nvm use`, which read `.nvmrc`. |
