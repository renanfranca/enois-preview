# LLM assistance guide

This guide describes the operator workflow, not universal compatibility with every LLM. Read the README, tutorial and VALIDATION.md before claiming implementation or revision acceptance.

Work in the local terminal. Never ask the operator to paste tokens, passwords, cookies or private files into the conversation. Authentication and initial financial confirmation belong in the terminal or official platform interface. Do not renew financial verification during publish, resume or merely because time passed.

Use the public commands exactly: `enois-preview setup`, `enois-preview publish <scenario>`, `enois-preview publish <scenario> --refresh-data`, and `enois-preview resume <revision>`. “Publish again” means publish without refresh. Do not replace them with a manual Docker, Git, GHCR and Wrangler sequence.

Check committed, clean sources in all three applications before publication. Do not automatically commit the operator's changes. The CLI exports commits and prepares demo adjustments outside the applications. Preserve private files and journals. For an incomplete capture, report restoration state and the retry action; resume must never recapture live data under an earlier identity.

Distinguish terminals: setup, authentication, preparation, publish and resume run locally. Codespaces must boot automatically. Opening its terminal to copy files or start processes is a boot failure, not a normal step.

Only describe a link as validated after exit zero and a report confirming public readiness, accounts, media and revision identity. Report failures and gaps. Never publish the public project while acceptance prerequisites remain outstanding. Immutable links do not promise permanent availability; visitors share state and accounts. Tell the operator to update the PR link and test its specific functionality; never edit the PR automatically.
