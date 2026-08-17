#!/usr/bin/env bash
# hooks/lib/gate-launcher.sh — stable entry point for the opt-in gate hooks.
#
# /onboard copies this file (plus a sibling resolver and fallback scripts) to
# the config root and registers the copy in settings.json in place of a path
# into the versioned plugin cache, so a plugin update never orphans the hook.
# Resolution happens at run time instead, three tiers, each falling through
# silently on failure (hooks fail open):
#
#   1. installed_plugins.json's recorded installPath for
#      superpowers@superpowers-dev — the registry the harness itself uses.
#   2. A version-sorted scan of the marketplace cache, delegated to the
#      sibling "superpowers-gate-resolver.sh" copy (itself an unmodified copy
#      of scripts/resolve-plugin-script.sh) rather than a second scan
#      reimplemented here.
#   3. The fallback copy of the gate scripts kept alongside this launcher.
#
# Usage: superpowers-gate-launcher.sh <script-name> [args...]
set -u

SCRIPT_NAME="${1:-}"
[ -n "$SCRIPT_NAME" ] || exit 0
shift

LAUNCHER_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

# Tier 1: installed_plugins.json.
if command -v node >/dev/null 2>&1; then
  INSTALL_PATH="$(node -e '
    const fs = require("fs");
    const path = require("path");
    try {
      const idx = JSON.parse(fs.readFileSync(path.join(process.argv[1], "plugins", "installed_plugins.json"), "utf8"));
      const entries = idx.plugins && idx.plugins["superpowers@superpowers-dev"];
      if (Array.isArray(entries) && entries.length) {
        const p = entries[entries.length - 1].installPath || "";
        if (p) process.stdout.write(p);
      }
    } catch {}
  ' "$ROOT" 2>/dev/null)"
  if [ -n "${INSTALL_PATH:-}" ] && [ -f "$INSTALL_PATH/hooks/examples/$SCRIPT_NAME" ]; then
    exec bash "$INSTALL_PATH/hooks/examples/$SCRIPT_NAME" "$@"
  fi
fi

# Tier 2: version-sorted cache scan, delegated to the sibling resolver copy.
# A non-127 exit from the resolver means it found and ran the target script,
# so its exit code (which may legitimately be nonzero — a gate hook can
# block) is propagated as-is. Exit 127 is the resolver's own "nothing
# installed" signal, so only that code falls through to tier 3.
RESOLVER="$LAUNCHER_DIR/superpowers-gate-resolver.sh"
if [ -f "$RESOLVER" ]; then
  bash "$RESOLVER" "hooks/examples/$SCRIPT_NAME" "$@"
  rc=$?
  [ "$rc" -eq 127 ] || exit "$rc"
fi

# Tier 3: the fallback copy installed alongside this launcher.
FALLBACK="$LAUNCHER_DIR/superpowers-gate-fallback/$SCRIPT_NAME"
if [ -f "$FALLBACK" ]; then
  exec bash "$FALLBACK" "$@"
fi

exit 0
