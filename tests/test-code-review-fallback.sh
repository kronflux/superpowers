#!/usr/bin/env bash
# Verifies the requesting-code-review dispatch + general-purpose fallback contract.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "FAIL: $1" >&2; exit 1; }

AGENT_CR="agents/code-reviewer.md"
AGENT_RT="agents/red-team.md"
SKILL="skills/requesting-code-review/SKILL.md"
TEMPLATE="skills/requesting-code-review/code-reviewer.md"

# 1. Named agents exist and are namespaced.
[ -f "$AGENT_CR" ] || fail "missing $AGENT_CR"
[ -f "$AGENT_RT" ] || fail "missing $AGENT_RT"
grep -q '^name: superpowers:code-reviewer$' "$AGENT_CR" || fail "code-reviewer not namespaced"
grep -q '^name: superpowers:red-team$'      "$AGENT_RT" || fail "red-team not namespaced"

# 2. red-team keeps read-only / no-execution constraints.
grep -q 'Do NOT execute code'        "$AGENT_RT" || fail "red-team missing no-execute constraint"
grep -q 'Do NOT use `ctx_execute`'   "$AGENT_RT" || fail "red-team missing ctx_execute prohibition"

# 3. Skill dispatches named agents in parallel.
grep -q 'superpowers:code-reviewer' "$SKILL" || fail "skill does not reference code-reviewer agent"
grep -q 'superpowers:red-team'      "$SKILL" || fail "skill does not reference red-team agent"

# 4. Fallback path: general-purpose + inline template.
grep -q 'general-purpose' "$SKILL"   || fail "skill missing general-purpose fallback"
[ -f "$TEMPLATE" ]                    || fail "missing inline template $TEMPLATE"
grep -q 'code-reviewer.md' "$SKILL"  || fail "skill does not reference inline template"

# 5. Never set subagent_type Bash on the review surface.
for f in "$AGENT_CR" "$AGENT_RT" "$SKILL"; do
  if grep -q 'subagent_type:"Bash"' "$f"; then fail "$f sets subagent_type Bash"; fi
done

echo "PASS: code-review dispatch + fallback contract holds"
