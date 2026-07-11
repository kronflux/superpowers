#!/usr/bin/env bash
# End-to-end tests for the two user-gate revalidation hooks:
#   hooks/examples/post-task-complete-revalidate.sh  (PostToolUse: TaskUpdate)
#   hooks/examples/stop-revalidate-user-gates.sh     (Stop)
#
# Input contract exercised (learned from the hook sources):
#   - Post hook stdin JSON: {tool_name, tool_input:{taskId,status}, transcript_path}
#   - Stop hook stdin JSON: {transcript_path}
#   - Transcripts are JSONL; TaskCreate gets 1-based ids in creation order;
#     gate = json:metadata fence with userGate:true / tags:["user-gate"] /
#     "USER-ORDERED GATE" banner in the description.
#   - Block contract: exit 2 + stderr message (no deny-JSON output).
#   - Fail-open contract: bad/empty input or missing deps must exit 0.
#
# The transcript-parsing paths need jq + a working python3. When either is
# missing (e.g. Windows without jq, or the WindowsApps python3 stub), the
# parsing cases print "SKIP (missing deps): case-N" - the fail-open and
# guard-bypass cases still run and are asserted.
#
# Output: one "PASS case-N" / "FAIL case-N" / "SKIP (missing deps): case-N"
# line per case, then a deterministic final line:
#   "10/10 passed" or "10/10 passed (N skipped-env)"
# Exits non-zero if any case failed.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
POST_HOOK="$ROOT/hooks/examples/post-task-complete-revalidate.sh"
STOP_HOOK="$ROOT/hooks/examples/stop-revalidate-user-gates.sh"

FIXDIR="$(mktemp -d)"
trap 'rm -rf "$FIXDIR"' EXIT
TRACE_LOG="$FIXDIR/trace.log"

# Deps: the hooks hardcode `jq` and `python3`. The WindowsApps python3 alias
# exists on PATH but cannot run code, so probe with -c, not command -v.
HAVE_DEPS=1
command -v jq >/dev/null 2>&1 || HAVE_DEPS=0
python3 -c 'print(1)' >/dev/null 2>&1 || HAVE_DEPS=0

# On Git Bash, native jq/python3 need Windows-style paths; bash's -f test
# accepts the mixed form (C:/...) too, so use it when cygpath is available.
fixpath() {
    if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi
}

# ---------------------------------------------------------------- fixtures

GATE_DESC='USER-ORDERED GATE\n\n```json:metadata\n{\"userGate\": true, \"acceptanceCriteria\": [\"todo list renders\", \"items can be added\"]}\n```'
NONGATE_DESC='**Goal:** build widget\n\n```json:metadata\n{\"acceptanceCriteria\": [\"widget builds\"]}\n```'

# Non-gate task: created, in_progress, assessment language in window.
cat > "$FIXDIR/nongate.jsonl" <<EOF
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"TaskCreate","input":{"subject":"Build widget","description":"$NONGATE_DESC"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"TaskUpdate","input":{"taskId":"1","status":"in_progress"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Build verified: tests passed, exit 0."}]}}
EOF

# Gate task, no AC:/PROVEN BY and no user message in the close window.
cat > "$FIXDIR/gate-noevidence.jsonl" <<EOF
{"type":"user","message":{"role":"user","content":"please build the todo list"}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"TaskCreate","input":{"subject":"react todo list works","description":"$GATE_DESC"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"TaskUpdate","input":{"taskId":"1","status":"in_progress"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Moving on to the next item."}]}}
EOF

# Same gate, with canonical per-criterion evidence in the window.
cat > "$FIXDIR/gate-evidence.jsonl" <<EOF
{"type":"user","message":{"role":"user","content":"please build the todo list"}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"TaskCreate","input":{"subject":"react todo list works","description":"$GATE_DESC"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"TaskUpdate","input":{"taskId":"1","status":"in_progress"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"AC: todo list renders - PROVEN BY vitest run 12/12 passed. AC: items can be added - PROVEN BY add-item click test output."}]}}
EOF

# Stop: no gate tasks at all, completion claim present.
cat > "$FIXDIR/stop-nogates.jsonl" <<EOF
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"All done. Plan complete."}]}}
EOF

# Stop: gate closed evidence-less, then a plan-complete claim.
cat > "$FIXDIR/stop-gate-noproof.jsonl" <<EOF
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"TaskCreate","input":{"subject":"react todo list works","description":"$GATE_DESC"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"TaskUpdate","input":{"taskId":"1","status":"in_progress"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"TaskUpdate","input":{"taskId":"1","status":"completed"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Plan complete - all gates passed."}]}}
EOF

# Stop: same close, but per-criterion proof after the close, then the claim.
cat > "$FIXDIR/stop-gate-proof.jsonl" <<EOF
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"TaskCreate","input":{"subject":"react todo list works","description":"$GATE_DESC"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"TaskUpdate","input":{"taskId":"1","status":"in_progress"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"TaskUpdate","input":{"taskId":"1","status":"completed"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"AC: todo list renders - PROVEN BY vitest run 12/12 passed. AC: items can be added - PROVEN BY add-item click test output."}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Plan complete - all gates passed."}]}}
EOF

post_input() { # $1=transcript file
    printf '{"tool_name":"TaskUpdate","tool_input":{"taskId":"1","status":"completed"},"transcript_path":"%s"}' "$(fixpath "$1")"
}
stop_input() { # $1=transcript file
    printf '{"transcript_path":"%s"}' "$(fixpath "$1")"
}

# ---------------------------------------------------------------- runner

FAILED=0
SKIPPED=0
STDERR_FILE="$FIXDIR/stderr.txt"

run_hook() { # $1=hook $2=stdin $3..=extra env VAR=VAL
    local hook="$1" input="$2"; shift 2
    printf '%s' "$input" | env SUPERPOWERS_USERGATE_TRACE_LOG="$TRACE_LOG" \
        SUPERPOWERS_USERGATE_GUARD=1 SUPERPOWERS_USERGATE_STOP_GUARD=1 \
        "$@" bash "$hook" >/dev/null 2>"$STDERR_FILE"
    echo $?
}

check() { # $1=case-N $2=expected-exit $3=actual-exit [$4=required stderr substring]
    local name="$1" want="$2" got="$3" substr="${4:-}"
    if [[ "$got" != "$want" ]]; then
        echo "FAIL $name (exit $got, wanted $want)"; FAILED=$((FAILED+1)); return
    fi
    if [[ -n "$substr" ]] && ! grep -q "$substr" "$STDERR_FILE"; then
        echo "FAIL $name (stderr missing: $substr)"; FAILED=$((FAILED+1)); return
    fi
    echo "PASS $name"
}

skip() { echo "SKIP (missing deps): $1"; SKIPPED=$((SKIPPED+1)); }

# ---------------------------------------------------------------- cases

# 1. post hook, empty stdin -> fail-open exit 0
check case-1 0 "$(run_hook "$POST_HOOK" '')"

# 2. post hook, garbage stdin -> fail-open exit 0
check case-2 0 "$(run_hook "$POST_HOOK" 'not json {{{')"

# 3. post hook allows close of a non-gate task with assessment on record
if [[ "$HAVE_DEPS" == 1 ]]; then
    check case-3 0 "$(run_hook "$POST_HOOK" "$(post_input "$FIXDIR/nongate.jsonl")")"
else skip case-3; fi

# 4. post hook blocks userGate:true close with no AC:/PROVEN BY in window
if [[ "$HAVE_DEPS" == 1 ]]; then
    check case-4 2 "$(run_hook "$POST_HOOK" "$(post_input "$FIXDIR/gate-noevidence.jsonl")")" "USER-GATE CLOSED"
else skip case-4; fi

# 5. post hook allows the same close when evidence lines are present
if [[ "$HAVE_DEPS" == 1 ]]; then
    check case-5 0 "$(run_hook "$POST_HOOK" "$(post_input "$FIXDIR/gate-evidence.jsonl")")"
else skip case-5; fi

# 6. SUPERPOWERS_USERGATE_GUARD=0 bypasses the block (guard checked pre-parse)
check case-6 0 "$(run_hook "$POST_HOOK" "$(post_input "$FIXDIR/gate-noevidence.jsonl")" SUPERPOWERS_USERGATE_GUARD=0)"

# 7. stop hook with no gate tasks -> exit 0
if [[ "$HAVE_DEPS" == 1 ]]; then
    check case-7 0 "$(run_hook "$STOP_HOOK" "$(stop_input "$FIXDIR/stop-nogates.jsonl")")"
else skip case-7; fi

# 8. stop hook blocks a plan-complete claim over an evidence-less gate close
if [[ "$HAVE_DEPS" == 1 ]]; then
    check case-8 2 "$(run_hook "$STOP_HOOK" "$(stop_input "$FIXDIR/stop-gate-noproof.jsonl")")" "PLAN-COMPLETE CLAIM DETECTED"
else skip case-8; fi

# 9. stop hook allows the claim when per-criterion evidence follows the close
if [[ "$HAVE_DEPS" == 1 ]]; then
    check case-9 0 "$(run_hook "$STOP_HOOK" "$(stop_input "$FIXDIR/stop-gate-proof.jsonl")")"
else skip case-9; fi

# 10. SUPERPOWERS_USERGATE_STOP_GUARD=0 bypasses the stop block
check case-10 0 "$(run_hook "$STOP_HOOK" "$(stop_input "$FIXDIR/stop-gate-noproof.jsonl")" SUPERPOWERS_USERGATE_STOP_GUARD=0)"

# ---------------------------------------------------------------- summary

if [[ "$FAILED" -gt 0 ]]; then
    echo "$((10 - FAILED))/10 passed"
    exit 1
fi
if [[ "$SKIPPED" -gt 0 ]]; then
    echo "10/10 passed ($SKIPPED skipped-env)"
else
    echo "10/10 passed"
fi
exit 0
