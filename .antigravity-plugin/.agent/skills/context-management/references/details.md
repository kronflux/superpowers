# Context Management — Extended Details

Overflow detail split out of `../SKILL.md` to keep the core skill under the size budget. Each section here is pointed to from the correspondingly-named part of `SKILL.md`.

## Searching the log at task start

**Step 1 — Extract keywords.** Take the 2-3 most distinctive nouns from the task description. Avoid generic words ("fix", "update", "file") — use domain nouns ("hook", "auth", "deploy", "staleness").

**Step 2 — Search each keyword individually first.** Per `${CLAUDE_PLUGIN_ROOT}/skills/shared/conductor/context-mode-adapter.md`, route the search via `ctx_search`/`ctx_execute_file` over `session-log.md` when context-mode is active; when inactive, use native grep (native fallback):
```bash
grep -i "<keyword1>" session-log.md | tail -20
grep -i "<keyword2>" session-log.md | tail -20
```
Check the hit count before reading results. This tells you whether to narrow or widen before committing to any output.

**Step 3 — Adjust based on hit count:**
- **0 hits on all keywords** → fall back to `project-map.md` Critical Constraints. Relevant history may have been promoted there instead of staying in the log. If still nothing, proceed without history.
- **1–10 hits** → read them. Surface past decisions, rejected approaches, and constraints.
- **>10 hits on one keyword** → narrow with a second term (route per the adapter; native shown for fallback): `grep -i "<kw1>" session-log.md | grep -i "<kw2>" | tail -20`

**Step 4 — Surface what matters.** If relevant entries are found, state them explicitly before proceeding: what was decided, what was rejected, what constraints apply. Don't silently absorb them — make them visible so the user can confirm or override.

## state.md vs plan.md

**state.md vs plan.md:**
- `plan.md` (or `docs/.../plans/*.md`): the authoritative task list with checkboxes. Owned by `executing-plans`. Updated as tasks complete.
- `state.md`: a session-boundary snapshot of *where you are* in the plan — current task, blockers, what's verified. It references the plan but does not duplicate the task list.

If a plan exists, state.md should say "Executing plan at docs/.../plan.md, currently on Task 3" — not copy the full task list.

## Checking for superseded entries

Search `session-log.md` for 2-3 keywords from the current decision (route per the adapter; native shown for fallback):
```bash
grep -i "<keyword>" session-log.md
```
Read any matching `[saved]` entries and ask: does the new decision *directly contradict* an old one? If yes, append `[superseded by YYYY-MM-DD]` to the old entry's header line — do not delete it. If the old entry is merely related but not contradicted, leave it unchanged. This is a judgment call, not a mechanical keyword match.

## ADR write — detection and skip conditions

**Detecting the convention:** before writing, check for an existing `docs/adr/` directory or an established `docs/` pattern (e.g. `docs/design/`, `docs/rfcs/`). No `docs/` directory and no ADR precedent → no convention to extend; skip silently.

**Offering when ambiguous:** `docs/` exists but no `docs/adr/` precedent → offer once, e.g. *"Want this design captured as an ADR under `docs/adr/`? A short, committable file distilled from the spec."* Declined → skip silently, do not re-offer in the same session.

**Writing:** follow `${CLAUDE_PLUGIN_ROOT}/skills/shared/conductor/doc-format.md` Authoring conventions for filename, frontmatter, and links. The ADR distills the approved design — decision, options considered, consequences — it is not a copy of the full spec.

## What belongs in a [saved] entry vs state.md, and hard limits

**What belongs here vs state.md:**
- `session-log.md [saved]`: permanent decisions, anti-patterns to avoid, carry-forward open items
- `state.md`: active task status, in-progress plans, checklists, version bump readiness — anything that will be resolved soon

**Never include in a [saved] entry:**
- Test results or verification confirmations ("11/11 tests pass")
- Task checklists, file changelogs, or release notes → use `state.md`
- "How it works" walkthroughs → read the code
- Speculative analysis not approved for implementation → use a design doc in `docs/`
- One-time confirmations ("file deleted", "folder removed")
- Newly discovered permanent architectural constraints → add to `project-map.md` Critical Constraints instead

**Hard limits per component — enforce while writing, not after:**
- Goal: 1 line, ≤15 words
- Decisions: ≤5 bullets for multi-subsystem sessions, ≤3 for single-topic. Each bullet: decision + one-sentence why, ≤25 words total. No prose, no rationale beyond the why.
- Rejected: ≤3 bullets, ≤15 words each. What to avoid — not the full story of why it failed.
- Open: ≤2 items, ≤12 words each.

If a decision doesn't fit in 25 words, the explanation belongs in a design doc. Cut the explanation, not the decision.

Total entry backstop: 250 words / 1500 chars. If exceeded, a bullet violated its limit — find it and cut it. Typical single-topic sessions should target ~120 words; the higher cap exists for multi-subsystem sessions that genuinely touched 5+ areas.

## session-log.md Format and Maintenance

The log contains a single entry type:

- **[saved]** — written by this skill when explicitly invoked: full decision record including goals, rationale, rejected approaches, and key facts.

**File management:**
- Lives at the project root alongside `CLAUDE.md` and `package.json`
- Keep under 200 entries — prune entries older than 6 months when it exceeds this
- When a decision is permanently superseded (e.g., the approach was replaced), mark it rather than deleting: append `[superseded by YYYY-MM-DD]`
- Do NOT log trivial sessions (the stop hook already filters these out)

**For cross-project recall** (finding how a similar problem was solved in a different codebase): `session-log.md` is per-project and keyword-searchable only. Cross-project recall is outside the scope of this system.
