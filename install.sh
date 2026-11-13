#!/usr/bin/env bash
# Bootstrap for the verified enois-preview installation.
#
#   COMMIT=<full public commit pinned in your launcher's tool.lock.json>
#   curl -fsSL "https://raw.githubusercontent.com/renanfranca/enois-preview/$COMMIT/install.sh" | bash -s -- "$COMMIT"
#
# It builds that commit in a temporary directory only to run its own installer, which downloads the
# commit again, verifies it and creates ~/.local/share/enois-preview/<COMMIT>. Nothing is kept here.
set -euo pipefail

main() {
  local usage='Usage: install.sh PUBLIC_TOOL_COMMIT [--prefix DIRECTORY]'
  local commit="${1:-}"
  if [[ ! "$commit" =~ ^[a-f0-9]{40}$ ]]; then
    echo "$usage" >&2
    echo 'Use the full 40 character public tool commit, never a branch or tag.' >&2
    return 1
  fi
  shift

  local tool
  for tool in node npm curl tar; do
    command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required and was not found in PATH." >&2; return 1; }
  done
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "$major" != 24 ]]; then
    echo "Node 24.x is required (>=24 <25); found $(node --version). Select it first, for example with nvm install 24." >&2
    return 1
  fi

  local work
  work="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$work'" EXIT

  echo "Downloading enois-preview $commit..." >&2
  if ! curl -fsSL --proto '=https' --tlsv1.2 -o "$work/source.tar.gz" "https://codeload.github.com/renanfranca/enois-preview/tar.gz/$commit"; then
    echo "Download of commit $commit failed. Confirm that it is a published public commit." >&2
    return 1
  fi
  mkdir "$work/source"
  tar -xzf "$work/source.tar.gz" -C "$work/source" --strip-components=1

  echo 'Building the installer (temporary, removed at the end)...' >&2
  if ! (cd "$work/source" && npm ci --ignore-scripts --no-audit --no-fund && npm run build) >"$work/bootstrap.log" 2>&1; then
    tail -n 40 "$work/bootstrap.log" >&2
    echo 'Building the installer failed; the output above is the end of its log.' >&2
    return 1
  fi

  echo 'Installing (download, verified build, command link and Chromium)...' >&2
  node "$work/source/dist/scripts/install-tool.js" --commit "$commit" "$@"
}

main "$@"
