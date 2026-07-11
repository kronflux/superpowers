#!/usr/bin/env bash
# Validate the generated Antigravity (.agent) profile.
#
# Asserts: AGENTS.md exists and documents each mapping keyword; >=20 skill
# SKILL.md files are present; every SKILL.md has name:/description: frontmatter;
# and ZERO legacy Claude Code patterns leaked through the sync transform.
#
# Uses grep (not rg) for portability. Prints "PROFILE OK" on success; on failure
# prints "PROFILE FAIL: <specifics>" to stderr and exits non-zero.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILLS_DIR="$AGENT_DIR/skills"
AGENTS="$AGENT_DIR/AGENTS.md"

fail() { echo "PROFILE FAIL: $*" >&2; exit 1; }

# 1. AGENTS.md exists and documents each mapping keyword.
[ -f "$AGENTS" ] || fail "missing AGENTS.md at $AGENTS"
for kw in view_file invoke_subagent ask_question task.md run_command grep_search find_by_name write_to_file replace_file_content; do
  grep -q "$kw" "$AGENTS" || fail "AGENTS.md does not document mapping keyword: $kw"
done

# 2. At least 20 skills/*/SKILL.md present.
[ -d "$SKILLS_DIR" ] || fail "missing skills dir at $SKILLS_DIR"
skill_count=$(find "$SKILLS_DIR" -mindepth 2 -maxdepth 2 -name SKILL.md | wc -l | tr -d ' ')
[ "$skill_count" -ge 20 ] || fail "expected >=20 SKILL.md, found $skill_count"

# 3. Every SKILL.md has name: and description: frontmatter.
while IFS= read -r sk; do
  grep -qE '^name:[[:space:]]*[^[:space:]]' "$sk" \
    || fail "SKILL.md missing name: frontmatter: $sk"
  grep -qE '^description:[[:space:]]*[^[:space:]]' "$sk" \
    || fail "SKILL.md missing description: frontmatter: $sk"
done < <(find "$SKILLS_DIR" -mindepth 2 -maxdepth 2 -name SKILL.md)

# 4. Zero legacy-pattern leakage in the transformed skills.
if leak=$(grep -rn "the Skill tool\|TodoWrite\|superpowers:\|EnterWorktree\|AskUserQuestion" "$SKILLS_DIR"); then
  echo "PROFILE FAIL: legacy-pattern leakage in transformed skills:" >&2
  echo "$leak" >&2
  exit 1
fi

echo "PROFILE OK ($skill_count skills)"
