#!/usr/bin/env bash
# Generate the committed Antigravity (.agent) distribution from the source skills.
#
# Antigravity has NO lifecycle hooks: bootstrap is gemini-extension.json
# (contextFileName: GEMINI.md) @-loading using-superpowers. Mirroring the
# transform-and-emit shape of sync-to-codex-plugin.sh, this script regenerates
# .antigravity-plugin/.agent/ from scratch, copies every skill (including its
# references/ subdirs — the one-level-deep files are load-bearing), rewrites
# Claude Code tool names to Antigravity equivalents per the AGENTS.md
# substitution contract, and drops in the AGENTS.md mapping + profile validator.
#
# Deterministic: LC_ALL=C + sorted iteration => byte-identical re-runs.
#
# Usage:
#   bash scripts/sync-to-antigravity.sh
set -euo pipefail
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_SKILLS="$REPO_ROOT/skills"
TEMPLATES="$SCRIPT_DIR/antigravity-templates"
PLUGIN="$REPO_ROOT/.antigravity-plugin"
OUT="$PLUGIN/.agent"

# Skills excluded from the profile.
#   using-git-worktrees: superseded by native `Workspace: "branch"` isolation on
#   invoke_subagent (documented in AGENTS.md). The manual `git worktree`
#   mechanics do not apply on Antigravity.
EXCLUDE="using-git-worktrees"

# --- Regenerate the output tree from scratch --------------------------------
rm -rf "$PLUGIN"
mkdir -p "$OUT/skills" "$OUT/tests"

# --- Copy skills (sorted, deterministic), excluding EXCLUDE ------------------
skill_count=0
while IFS= read -r dir; do
  name="$(basename "$dir")"
  [ "$name" = "$EXCLUDE" ] && continue
  cp -R "$dir" "$OUT/skills/$name"
  skill_count=$((skill_count + 1))
done < <(find "$SRC_SKILLS" -mindepth 1 -maxdepth 1 -type d | LC_ALL=C sort)

# --- Transform every copied .md file per the substitution contract ----------
# ORDER MATTERS:
#   1. superpowers:<name> namespace rewrites -> relative .agent/skills/<name>/SKILL.md
#      paths BEFORE any bare-token subs (so "superpowers:" never survives).
#   2. "the Skill tool" before bare "Skill tool".
#   3. Distinctive CamelCase tool tokens (unambiguous — zero false positives).
#   4. Common-word tools (Read/Write/Edit/Bash/Grep/Glob) only when backtick-
#      delimited, so English prose ("Read the file", "run bash") is left intact;
#      the non-backticked mentions are mapped by AGENTS.md at read time. This is
#      the same convention gemini-tools.md and the reference profile use.
file_count=0
while IFS= read -r f; do
  sed -E -i \
    -e 's#superpowers:<name>#.agent/skills/<name>/SKILL.md#g' \
    -e 's#superpowers:([a-z][a-z0-9-]*)#.agent/skills/\1/SKILL.md#g' \
    -e 's#the Skill tool#view_file on the SKILL.md#g' \
    -e 's#Skill tool#view_file on the SKILL.md#g' \
    -e 's#AskUserQuestion#ask_question#g' \
    -e 's#TodoWrite#the task.md task list#g' \
    -e 's#TaskCreate#the task.md task list#g' \
    -e 's#TaskUpdate#the task.md task list#g' \
    -e 's#TaskList#the task.md task list#g' \
    -e 's#TaskGet#the task.md task list#g' \
    -e 's#EnterWorktree#Workspace: "branch"#g' \
    -e 's#ExitWorktree#the default Workspace#g' \
    -e 's#WebSearch#search_web#g' \
    -e 's#WebFetch#read_url_content#g' \
    -e 's#`Read`#`view_file`#g' \
    -e 's#`Write`#`write_to_file`#g' \
    -e 's#`Edit`#`replace_file_content`#g' \
    -e 's#`Bash`#`run_command`#g' \
    -e 's#`Grep`#`grep_search`#g' \
    -e 's#`Glob`#`find_by_name`#g' \
    "$f"
  file_count=$((file_count + 1))
done < <(find "$OUT/skills" -type f -name '*.md' | LC_ALL=C sort)

# --- Targeted fixups (context-aware, post-sed) -------------------------------
#   using-git-worktrees is excluded from this profile (see EXCLUDE above), so
#   the routing-table row naming it would dead-end. Point the transformed copy
#   at the native Workspace isolation instead. Source SKILL.md is untouched:
#   it sits at the session-start payload ceiling.
sed -i 's#|Risky work, isolation|using-git-worktrees|#|Risky work, isolation|Workspace: "branch" on invoke_subagent (see AGENTS.md)|#' \
  "$OUT/skills/using-superpowers/SKILL.md"

# --- Drop in the mapping contract + profile validator -----------------------
cp "$TEMPLATES/AGENTS.md" "$OUT/AGENTS.md"
cp "$TEMPLATES/check-antigravity-profile.sh" "$OUT/tests/check-antigravity-profile.sh"
chmod +x "$OUT/tests/check-antigravity-profile.sh"

echo "sync-to-antigravity: $skill_count skills, $file_count markdown files -> $OUT"
