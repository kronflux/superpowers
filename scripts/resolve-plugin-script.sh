#!/usr/bin/env bash
# resolve-plugin-script.sh — exec a superpowers plugin script from the highest installed version.
# Usage: resolve-plugin-script.sh <relative-script-path> [args...]
set -euo pipefail
rel="${1:?usage: resolve-plugin-script.sh <relative-script-path> [args...]}"; shift || true
root="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
base="$root/plugins/cache/superpowers-dev/superpowers"
ver="$(ls -1 "$base" 2>/dev/null | sort -V | tail -1 || true)"
target="$base/$ver/$rel"
if [ -z "$ver" ] || [ ! -f "$target" ]; then
  echo "resolve-plugin-script: no installed superpowers script at $base/*/$rel" >&2
  exit 127
fi
exec bash "$target" "$@"
