#!/usr/bin/env bash
# PostToolUse hook: when a USER-THROWN gate task is closed, force Claude to
# re-state evidence before moving on.
#
# Add this to your project's .claude/settings.json (see README).
#
# ## What it does
#
# Triggers on TaskUpdate tool calls with status=completed. Looks up the
# task's description in the session transcript and parses the embedded
# `json:metadata` fence. If metadata says the task is a user-thrown gate —
# `userGate: true` OR `tags` contains `"user-gate"` — emits a blocking
# reminder (exit 2 + stderr) that forces Claude to confirm every
# acceptanceCriteria with concrete evidence in the next turn.
#
# Regular (non-gate) tasks pass through silently.
#
# ## Why PostToolUse (not PreToolUse)
#
# The close itself is allowed — a user-gate task *can* legitimately be
# completed. What the hook protects against is closing-and-moving-on
# without proof. PostToolUse fires after the tool succeeds, so the block
# is a system-reminder the model MUST address before its next action,
# not a refusal to close the task.
#
# ## Escape hatch
#
# Set SUPERPOWERS_USERGATE_GUARD=0 to disable at runtime. The hook is
# opt-in already, so an escape hatch exists mainly for subagent contexts
# where re-validation has already happened upstream.

# Trace logging — every decision point writes one line to the shared trace
# log. Tail with: tail -F /tmp/claude-hooks/user-gate-trace.log
TRACE_LOG="${SUPERPOWERS_USERGATE_TRACE_LOG:-/tmp/claude-hooks/user-gate-trace.log}"
mkdir -p "$(dirname "$TRACE_LOG")" 2>/dev/null || true
trace() {
    # Args: task_id event reason
    local tid="${1:-?}" event="${2:-?}" reason="${3:-}"
    printf '%s | post-complete | task=%s | %s%s\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$tid" "$event" \
        "${reason:+ | $reason}" >> "$TRACE_LOG" 2>/dev/null || true
}

if [[ "${SUPERPOWERS_USERGATE_GUARD:-1}" == "0" ]]; then
    trace "?" "skip" "guard=0"
    exit 0
fi

# Fail-open: if anything unexpected breaks, never block.
trap 'trace "?" "error" "trap-ERR"; exit 0' ERR

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
[[ "$TOOL_NAME" != "TaskUpdate" ]] && { trace "?" "skip" "tool=$TOOL_NAME"; exit 0; }

STATUS=$(echo "$INPUT" | jq -r '.tool_input.status // empty' 2>/dev/null)
[[ "$STATUS" != "completed" ]] && { trace "?" "skip" "status=$STATUS"; exit 0; }

TASK_ID=$(echo "$INPUT" | jq -r '.tool_input.taskId // empty' 2>/dev/null)
[[ -z "$TASK_ID" ]] && { trace "?" "skip" "no-task-id"; exit 0; }

trace "$TASK_ID" "enter" "status=completed"

TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
[[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]] && { trace "$TASK_ID" "skip" "no-transcript"; exit 0; }


# Walk the transcript JSONL to find the TaskCreate (and any later TaskUpdate)
# for this taskId, extract the description, and parse the json:metadata fence.
# Python (no heredoc — avoids bash 5.3 heredoc-hang regression).
PY_PARSE='
import json, re, sys
path = sys.argv[1]
task_id = str(sys.argv[2])

description = ""
subject = ""
# IDs are NOT reliably 1-based or sequential in a real session (this bug was
# diagnosed on a session that ran tasks #32-#81). The authoritative id is
# whatever the TaskCreate tool_result for Claude Code actually reports back:
# "Task #<N> created successfully: ...". Pair each TaskCreate tool_use (by
# its own "id") with the tool_result whose tool_use_id matches it, and read
# the real id out of that text. Positional counting is kept ONLY as a
# fallback for a TaskCreate whose tool_result is missing (e.g. a truncated
# transcript).
next_id = 1
# Track line indices for the scan window below: where the most recent
# in_progress status change occurred for this taskId, and all assistant-text
# messages. If evidence already appears between in_progress and the close,
# the hook should NOT re-fire — that is what "already validated" means.
last_inprogress_idx = -1
text_indices = []  # list of (line_idx, text) — assistant text messages
user_text_indices = []  # list of (line_idx, text) — only true user messages, not tool_results
tool_result_indices = []  # list of (line_idx, text) — tool_result content (subagent reports, Bash output)

try:
    with open(path) as f:
        lines = f.readlines()
except Exception:
    print(json.dumps({}))
    sys.exit(0)

# Pass 1: collect every TaskCreate tool_use (its tool_use_id, description,
# subject, and a positional fallback id) plus the text of every tool_result
# keyed by tool_use_id, then resolve each TaskCreate to its REAL task id
# before pass 2 does anything id-sensitive.
create_calls = []       # ordered [{tool_use_id, description, subject, fallback_id}]
tool_result_by_id = {}  # tool_use_id -> text

for line in lines:
    try:
        entry = json.loads(line)
    except Exception:
        continue
    etype = entry.get("type")
    if etype == "user":
        msg = entry.get("message") or {}
        content = msg.get("content")
        if isinstance(content, list):
            for c in content:
                if isinstance(c, dict) and c.get("type") == "tool_result":
                    tuid = c.get("tool_use_id")
                    inner = c.get("content")
                    text = ""
                    if isinstance(inner, str):
                        text = inner
                    elif isinstance(inner, list):
                        text = "\n".join(
                            ic.get("text", "") or ""
                            for ic in inner
                            if isinstance(ic, dict) and ic.get("type") == "text"
                        )
                    if tuid and text.strip():
                        tool_result_by_id[tuid] = text
        continue
    if etype != "assistant":
        continue
    for c in (entry.get("message") or {}).get("content") or []:
        if not isinstance(c, dict) or c.get("type") != "tool_use":
            continue
        if c.get("name") == "TaskCreate":
            inp = c.get("input") or {}
            create_calls.append({
                "tool_use_id": c.get("id"),
                "description": inp.get("description", "") or "",
                "subject": inp.get("subject", "") or "",
                "fallback_id": str(next_id),
            })
            next_id += 1
        elif c.get("name") == "TaskUpdate":
            # Same self-correction as before: if a TaskUpdate references an
            # id past our positional guess, bump the fallback counter past
            # it too, so any still-unresolved TaskCreate guesses better.
            tid = str((c.get("input") or {}).get("taskId", ""))
            try:
                if int(tid) >= next_id:
                    next_id = int(tid) + 1
            except (ValueError, TypeError):
                pass

id_re = re.compile(r"Task #(\d+) created successfully")
for call in create_calls:
    m2 = id_re.search(tool_result_by_id.get(call["tool_use_id"], ""))
    real_id = m2.group(1) if m2 else call["fallback_id"]
    if real_id == task_id:
        description = call["description"]
        subject = call["subject"]

# Pass 2: everything else is unrelated to id resolution — TaskUpdate
# overrides (description edits, in_progress marker) plus the text/user/
# tool_result windows used by the evidence and assessment scans below.
for idx, line in enumerate(lines):
    try:
        entry = json.loads(line)
    except Exception:
        continue
    etype = entry.get("type")
    # Collect user-authored text for the user-verification check. The
    # transcript also carries tool_result entries under type=user, so we
    # must distinguish "string content" (real user message) from an
    # array content that only holds tool_results. Pure-string content is
    # the reliable signal of direct user input.
    if etype == "user":
        msg = entry.get("message") or {}
        content = msg.get("content")
        if isinstance(content, str) and content.strip():
            user_text_indices.append((idx, content))
        elif isinstance(content, list):
            # Array content can be true user text OR tool_result wrappers.
            # Distinguish: a dict with type=text means user direct input; a
            # dict with type=tool_result carries tool output (subagent report,
            # Bash output, etc.) which we collect separately.
            has_user_text = False
            for c in content:
                if not isinstance(c, dict):
                    continue
                if c.get("type") == "text" and not has_user_text:
                    t = c.get("text", "") or ""
                    if t.strip():
                        user_text_indices.append((idx, t))
                        has_user_text = True
                elif c.get("type") == "tool_result":
                    # tool_result content itself can be string or array.
                    inner = c.get("content")
                    if isinstance(inner, str) and inner.strip():
                        tool_result_indices.append((idx, inner))
                    elif isinstance(inner, list):
                        for ic in inner:
                            if isinstance(ic, dict) and ic.get("type") == "text":
                                tt = ic.get("text", "") or ""
                                if tt.strip():
                                    tool_result_indices.append((idx, tt))
        continue
    if etype != "assistant":
        continue
    msg = entry.get("message") or {}
    for c in msg.get("content") or []:
        if not isinstance(c, dict):
            continue
        if c.get("type") == "text":
            txt = c.get("text", "") or ""
            if txt.strip():
                text_indices.append((idx, txt))
            continue
        if c.get("type") != "tool_use":
            continue
        name = c.get("name", "")
        inp = c.get("input") or {}
        if name == "TaskUpdate":
            tid = str(inp.get("taskId", ""))
            if tid == task_id:
                if inp.get("description"):
                    description = inp.get("description", "") or ""
                if inp.get("status") == "in_progress":
                    last_inprogress_idx = idx

out = {"parsed": True, "subject": subject, "userGate": False, "tags": [],
       "criteria": [], "evidence_on_record": False,
       "user_verification_in_window": False,
       "agent_last_assessment": False,
       "last_agent_text_preview": ""}

# Parse the `json:metadata` code fence inside the task description.
m = re.search(r"```json:metadata\s*\n(.*?)\n```", description, re.DOTALL)
if m:
    try:
        meta = json.loads(m.group(1))
        out["userGate"] = bool(meta.get("userGate", False))
        tags = meta.get("tags", [])
        out["tags"] = tags if isinstance(tags, list) else []
        crits = meta.get("acceptanceCriteria", [])
        out["criteria"] = crits if isinstance(crits, list) else []
    except Exception:
        pass

# Also count a task as a gate if the description carries the verbatim
# USER-ORDERED GATE banner, even when the metadata fence is missing.
if "USER-ORDERED GATE" in description.upper():
    out["userGate"] = True

# Evidence scan: if at least one assistant-text message between the most
# recent in_progress for this task and now contains an AC:/PROVEN BY
# marker, treat the close as already validated. Scope the window to the
# in_progress marker to avoid counting evidence from a *different* gate.
# If no in_progress was seen (agent skipped straight to completed), fall
# back to scanning the whole transcript.
scan_from = last_inprogress_idx if last_inprogress_idx >= 0 else 0
ac_re = re.compile(r"\bAC\s*:", re.IGNORECASE)
pb_re = re.compile(r"\bPROVEN\s+BY\b", re.IGNORECASE)
for (i, txt) in text_indices:
    if i < scan_from:
        continue
    if ac_re.search(txt) or pb_re.search(txt):
        out["evidence_on_record"] = True
        break

# User-verification check: did the user send a real message in the window
# between this task going in_progress and the current close? A direct user
# message during the task execution is a strong signal that the close is
# intentional and observed.
for (i, txt) in user_text_indices:
    if i >= scan_from:
        out["user_verification_in_window"] = True
        break

# Agent-last-output assessment: catches "verified / tested / passed / result /
# works / completed" style signals. Scans assistant text AND tool_result content
# in the window — subagent reports arrive as tool_result entries, and a close
# right after a successful subagent return would otherwise look silent.
assess_re = re.compile(
    r"\b(verified|confirmed|tested|checked|passed|success|succeeded|result|output|works?|working|acceptance|criterion|criteria|proven|observed|shows?|displayed|returned|exit\s*0|all\s+green|done|complete|built|created|written|wrote)\b",
    re.IGNORECASE,
)

in_window_texts = [t for (i, t) in text_indices if i >= scan_from]
in_window_results = [t for (i, t) in tool_result_indices if i >= scan_from]

if in_window_texts:
    out["last_agent_text_preview"] = in_window_texts[-1][:240]

# Check assistant text first
for txt in in_window_texts:
    if assess_re.search(txt):
        out["agent_last_assessment"] = True
        break

# If no text signal, check tool_result content (subagent + Bash output)
if not out["agent_last_assessment"]:
    for rtxt in in_window_results:
        if assess_re.search(rtxt):
            out["agent_last_assessment"] = True
            break

# Axis-based evidence enforcement: the plan declares WHAT axes must appear in
# the close evidence. Each axis = a list of alternative tokens; at least one
# token per axis must be present in the window.
#
#   "requireEvidenceTokens": [
#     ["v2", "legacy", "old-flow"],           # axis 1: pre-state
#     ["v3", "migrated", "new-flow"]          # axis 2: post-state
#   ]
#
# Use cases: A/B refactor, v2→v3 migration, perf before/after, security
# pre/post-fix, multi-arm experiments (3+ axes), etc. Fully generic.
#
# Shortcut: `requireABCompare: true` expands to a canonical before/after pair.
out["ab_compare_required"] = False
out["ab_compare_satisfied"] = False
out["ab_missing_axes"] = []
axes = []
if m:
    try:
        meta_for_ab = json.loads(m.group(1))
        raw_axes = meta_for_ab.get("requireEvidenceTokens")
        if isinstance(raw_axes, list) and all(isinstance(a, list) for a in raw_axes):
            axes = [a for a in raw_axes if a]
        elif meta_for_ab.get("requireABCompare") is True:
            axes = [
                ["baseline", "old", "before", "v0", "v1", "iter-0", "iter0",
                 "original", "pre"],
                ["new", "refactored", "after", "v2", "iter-1", "iter1",
                 "post", "updated", "replacement"],
            ]
    except Exception:
        pass

if axes:
    out["ab_compare_required"] = True
    corpus = in_window_texts + in_window_results
    missing = []
    for i, axis_tokens in enumerate(axes):
        pattern = r"\b(" + "|".join(re.escape(str(t)) for t in axis_tokens if t) + r")\b"
        axis_re = re.compile(pattern, re.IGNORECASE)
        if not any(axis_re.search(txt) for txt in corpus):
            missing.append({"index": i, "tokens": axis_tokens})
    out["ab_compare_satisfied"] = len(missing) == 0
    out["ab_missing_axes"] = missing

print(json.dumps(out))
'

# See lib-python.sh: `command -v python3` alone is not a liveness check —
# on Windows it is often the Store App Execution Alias stub, which exists
# on PATH but exits non-zero instead of running anything.
source "$(dirname "${BASH_SOURCE[0]}")/lib-python.sh"
if ! sp_resolve_python; then
    trace "$TASK_ID" "skip" "no-python-interpreter"
    exit 0
fi

RESULT=$("${SP_PYTHON[@]}" -c "$PY_PARSE" "$TRANSCRIPT_PATH" "$TASK_ID" 2>/dev/null || echo "{}")

# Fail-open contract (line 49): an absent "parsed" sentinel means the parse
# never completed (crashed, interpreter died mid-script, empty transcript
# read failure) — that is "no information", not "checked, found nothing".
# Only a parse that actually ran gets to make a blocking decision below.
PARSED=$(echo "$RESULT" | jq -r '.parsed // false' 2>/dev/null)
if [[ "$PARSED" != "true" ]]; then
    trace "$TASK_ID" "skip" "parse-produced-no-result"
    exit 0
fi

USER_GATE_FLAG=$(echo "$RESULT" | jq -r '.userGate // false' 2>/dev/null)
TAGS_LIST=$(echo "$RESULT" | jq -r '.tags // [] | join(",")' 2>/dev/null)
AC_COUNT=$(echo "$RESULT" | jq -r '.criteria // [] | length' 2>/dev/null)
USER_VERIFY=$(echo "$RESULT" | jq -r '.user_verification_in_window // false' 2>/dev/null)
AGENT_ASSESS=$(echo "$RESULT" | jq -r '.agent_last_assessment // false' 2>/dev/null)
EVIDENCE_ON_RECORD=$(echo "$RESULT" | jq -r '.evidence_on_record // false' 2>/dev/null)
AB_REQUIRED=$(echo "$RESULT" | jq -r '.ab_compare_required // false' 2>/dev/null)
AB_SATISFIED=$(echo "$RESULT" | jq -r '.ab_compare_satisfied // false' 2>/dev/null)

trace "$TASK_ID" "parsed" "userGate=$USER_GATE_FLAG tags=[$TAGS_LIST] ac=$AC_COUNT evidence=$EVIDENCE_ON_RECORD user_verify=$USER_VERIFY agent_assess=$AGENT_ASSESS ab_req=$AB_REQUIRED ab_ok=$AB_SATISFIED"

# A satisfied A/B compare counts as an agent-assessment signal for the rest
# of the decision tree. Prevents the "ab_ok=true but falls through to silent-
# close" path.
if [[ "$AB_REQUIRED" == "true" && "$AB_SATISFIED" == "true" ]]; then
    AGENT_ASSESS="true"
fi

# Evidence-axis enforcement: each declared axis must show at least one token.
if [[ "$AB_REQUIRED" == "true" && "$AB_SATISFIED" != "true" ]]; then
    SUBJECT=$(echo "$RESULT" | jq -r '.subject // "(unknown)"' 2>/dev/null)
    MISSING_JSON=$(echo "$RESULT" | jq -c '.ab_missing_axes // []' 2>/dev/null)
    trace "$TASK_ID" "block" "evidence-axes-missing subject='$SUBJECT'"
    {
        echo "TASK CLOSE MISSING DECLARED EVIDENCE AXES"
        echo
        echo "Task #$TASK_ID ('$SUBJECT') requires at least one token from each"
        echo "evidence axis to appear in the close window (assistant text OR"
        echo "tool_result content). These axes are unsatisfied:"
        echo
        echo "$MISSING_JSON" | jq -r '.[] | "  axis #\(.index): need one of " + (.tokens | join(" | "))' 2>/dev/null || true
        echo
        echo "Each axis is a claim the plan makes about your close: to prove a"
        echo "v2→v3 migration worked you need to say something about v2 AND about"
        echo "v3; to prove a before/after refactor you need a baseline AND a new"
        echo "observation. Post a one-line summary that references a token from"
        echo "every axis, then reclose."
        echo
        echo "If the axis set is wrong for this task, update the task's"
        echo "\`requireEvidenceTokens\` metadata via TaskUpdate — but do that"
        echo "transparently, not as a hook bypass."
        echo
        echo "(Runtime disable: SUPERPOWERS_USERGATE_GUARD=0. Trace: $TRACE_LOG)"
    } >&2
    exit 2
fi

IS_GATE=$(echo "$RESULT" | jq -r '
    (.userGate == true) or ((.tags // []) | any(. == "user-gate"))
' 2>/dev/null)

# -----------------------------------------------------------------
# Decision tree — every close now gets a proper assessment.
# -----------------------------------------------------------------
# 1. User-gate task: strongest rule. Evidence (AC:/PROVEN BY) required,
#    unless user verification is present in the window (user confirmed).
# 2. Non-gate task: lighter check. Either a user message OR agent observation
#    language in the last text must be present. Silent close → flag.
# -----------------------------------------------------------------

if [[ "$IS_GATE" == "true" ]]; then
    [[ "$EVIDENCE_ON_RECORD" == "true" ]] && { trace "$TASK_ID" "pass" "gate-evidence-on-record"; exit 0; }
    [[ "$USER_VERIFY" == "true" ]] && { trace "$TASK_ID" "pass" "gate-user-verified"; exit 0; }
    trace "$TASK_ID" "block" "gate-without-evidence-or-user ac=$AC_COUNT"
else
    # Non-gate path: allow if ANY assessment signal is present.
    if [[ "$USER_VERIFY" == "true" || "$AGENT_ASSESS" == "true" || "$EVIDENCE_ON_RECORD" == "true" ]]; then
        trace "$TASK_ID" "pass" "assessed uv=$USER_VERIFY aa=$AGENT_ASSESS ev=$EVIDENCE_ON_RECORD"
        exit 0
    fi
    trace "$TASK_ID" "block" "silent-close uv=false aa=false"
fi

SUBJECT=$(echo "$RESULT" | jq -r '.subject // "(unknown)"' 2>/dev/null)
CRITERIA_JSON=$(echo "$RESULT" | jq -c '.criteria // []' 2>/dev/null)
LAST_AGENT_PREVIEW=$(echo "$RESULT" | jq -r '.last_agent_text_preview // ""' 2>/dev/null)

# Non-gate silent-close: shorter stderr, more about the assessment prompt.
if [[ "$IS_GATE" != "true" ]]; then
    {
        echo "TASK CLOSED WITHOUT ASSESSMENT — WAS THIS INTENTIONAL?"
        echo
        echo "Task #$TASK_ID ('$SUBJECT') just went to status=completed, but:"
        echo "  • No user message in the window since it went in_progress"
        echo "    (no confirmation, no AskUserQuestion answer, no pushback)"
        echo "  • No assessment language in your last output"
        echo "    (no 'verified / confirmed / passed / result / works / tested /"
        echo "    all green / exit 0 / acceptance' — nothing observable)"
        echo
        if [[ -n "$LAST_AGENT_PREVIEW" ]]; then
            echo "  Your last text was (truncated): \"$LAST_AGENT_PREVIEW\""
            echo
        fi
        echo "Self-assess BEFORE reclosing:"
        echo "  1. Did you actually run the task's work? If you dispatched a"
        echo "     subagent, did you inspect its report before closing?"
        echo "  2. Did you mentally verify without writing it down? Write one"
        echo "     line summarising what you observed (e.g. 'tests pass 12/12',"
        echo "     'file created', 'endpoint returned 200') — THEN reclose."
        echo "  3. Is this task genuinely complete or did you move on out of"
        echo "     inertia? Consider status=cancelled with a reason, not"
        echo "     completed, if the work wasn't actually done."
        echo
        echo "What NOT to do: do NOT reclose with status=completed and silence"
        echo "hoping the hook stops caring. It will flag again. The fix is a"
        echo "one-line observation, not bypassing the check."
        echo
        echo "(Runtime disable: SUPERPOWERS_USERGATE_GUARD=0. Trace log:"
        echo " $TRACE_LOG)"
    } >&2
    exit 2
fi

# Gate path — existing longer stderr with the /gate-check routing.
{
    echo "USER-GATE CLOSED — SELF-ASSESS BEFORE RE-VALIDATING"
    echo
    echo "Task #$TASK_ID ('$SUBJECT') is a USER-ORDERED gate. You just closed it"
    echo "without posting AC:/PROVEN BY evidence in this turn."
    echo
    echo "First — was this a hallucination? Check your own read:"
    echo "  • Did you already post the evidence inline in a previous turn using"
    echo "    different wording? Re-open TaskList / scroll back. If yes, re-state"
    echo "    it in the canonical shape (AC: <criterion> — PROVEN BY <output>)"
    echo "    so this hook recognises it."
    echo "  • Did you mis-tag a regular task as a gate? If the metadata flip"
    echo "    was your own mistake, fix the metadata (remove userGate/tags)"
    echo "    with a TaskUpdate then retry the close."
    echo
    echo "If it is a real gate and evidence is genuinely missing, route it"
    echo "through the user-gate flow — do NOT just reclose it:"
    echo
    echo "    1. TaskUpdate taskId=$TASK_ID status=in_progress"
    echo "    2. /gate-check $TASK_ID"
    echo
    echo "/gate-check runs the 'do I know HOW?' self-check, then either executes"
    echo "the verification with captured evidence OR hands off to /specify-gate"
    echo "when the HOW is ambiguous. It posts one line per acceptance criterion:"
    echo "    AC: <criterion> — PROVEN BY <evidence>"
    echo
    echo "Acceptance criteria on record:"
    echo "$CRITERIA_JSON" | jq -r '.[] | "  - " + .' 2>/dev/null || true
    echo
    echo "If /gate-check is not installed in this harness, post the AC: lines"
    echo "inline by running the verification yourself. Either way, do NOT move"
    echo "on without concrete evidence per criterion."
    echo "(To disable this check, set SUPERPOWERS_USERGATE_GUARD=0.)"
} >&2

exit 2
