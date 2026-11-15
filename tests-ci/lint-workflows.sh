#!/usr/bin/env bash
# Runs the same actionlint release as the build workflow, checked by sha256, against .github/workflows.
set -euo pipefail
version=1.7.12
sha256=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cache="${XDG_CACHE_HOME:-$HOME/.cache}/enois-preview/actionlint-$version"
if [ ! -x "$cache/actionlint" ]; then
  archive="actionlint_${version}_linux_amd64.tar.gz"
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  curl -fsSLo "$work/$archive" "https://github.com/rhysd/actionlint/releases/download/v$version/$archive"
  echo "$sha256  $work/$archive" | sha256sum -c - >/dev/null
  mkdir -p "$cache"
  tar -xzf "$work/$archive" -C "$cache" actionlint
fi
cd "$root"
"$cache/actionlint" -color
