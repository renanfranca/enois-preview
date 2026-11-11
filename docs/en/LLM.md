# LLM assistance guide

[Português do Brasil](../pt-BR/LLM.md) · [README](README.md) · [Concepts](CONCEPTS.md) · [Recipes](RECIPES.md)

This guide describes how an assistant should help the operator; it does not promise universal compatibility with every LLM. Read the [README](README.md), [concepts](CONCEPTS.md), [tutorial](TUTORIAL.md), [recipes](RECIPES.md) and [VALIDATION.md](../../VALIDATION.md) before claiming implementation or revision acceptance.

## How to guide

- Use the public commands exactly: `enois-preview setup`, `enois-preview publish <scenario>`, `enois-preview publish <scenario> --refresh-data`, `enois-preview resume <revision>` and `enois-preview source-digest` (read only). “Publish again” means `publish` without refresh.
- For each situation, follow the matching recipe in [Recipes](RECIPES.md) and copy the real CLI error message when looking for the cause.
- Installation, authentication, preparation, `publish` and `resume` run in the local terminal. The Codespace must boot by itself; needing to open its terminal to copy files or start processes is a boot failure, not a normal step.
- Only describe a link as validated after exit zero and a report confirming public readiness, accounts, media and revision identity. Report failures and gaps.
- Tell the operator to update the link in the pull request (PR) and test its specific functionality. Immutable links do not promise permanent availability, and visitors share state and accounts.
- For an incomplete capture, report the restoration state and the retry action. For an interruption, follow the [Ctrl+C and SIGTERM recipe](RECIPES.md#6-ctrlc-sigterm-or-a-killed-process): wait for restoration, preserve `restoration.json` and use `resume` for an already frozen revision.

## Prohibitions

- Never ask the operator to paste tokens, passwords, cookies or private files into the conversation. Authentication and initial financial confirmation belong in the terminal or the official platform interface.
- Do not renew financial verification during `publish`, `resume` or merely because time passed.
- Do not replace the public commands with a manual Docker, Git, GHCR and Wrangler sequence.
- Do not automatically commit the operator's changes. Before publication, check committed, clean sources in all three applications; the CLI exports commits and prepares demo adjustments outside the applications.
- Do not delete private files, journals, `restoration.json` or another operation's leases.
- `resume` must never recapture live data under an earlier identity.
- Never edit the PR automatically.
- Do not suggest scraping or importing other people's content to reproduce a problem. Recommend fictional data shaped like the case, as in [Show in the PR that the problem is fixed](RECIPES.md#9-show-in-the-pr-that-the-problem-is-fixed).
- Never publish the public project while acceptance prerequisites remain outstanding.
- Do not run Python, convert historical formats or resume Python journals. New records require `format: "enois-preview-ts-v1"`; preserve earlier records and create a fresh installation.
- Do not find processes by name to terminate them. On Linux, each managed command has its own process group, and a timeout sends `SIGKILL` to that group, including descendants remaining in it; services intentionally started in independent groups stay active.
- Preserve records from before 0.3.0 without claiming their resumes were validated.

## Toolchain

The toolchain is TypeScript: use Node 24.x (`>=24 <25`) and run `npm run build` after `npm ci --ignore-scripts`. Publication and resume use only the verified installation created by `install-tool` (see [`toolCommit` and `install.json`](CONCEPTS.md#toolcommit-and-installjson)). The private launcher also builds its dependency explicitly and uses `launcher.ts`.
