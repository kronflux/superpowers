# Upstream Sync Playbook

Manual, per-release procedure for reviewing what changed in `obra/superpowers` since this fork's
last sync and applying whatever still makes sense. This is a **review-and-apply** process, not an
automated merge: every upstream change is read, classified against
[fork-divergence-map.md](fork-divergence-map.md), and either applied directly or turned into a
proposed change to a fork-owned router/adapter/hook. Nothing is rebased or cherry-picked wholesale.

## Why not rebase or cherry-pick

- **No `git rebase`.** This fork's history (the `feat/conductor-*` branches, the 7.0.0 resync
  itself) is its own linear story on top of a specific upstream base commit. Rebasing onto a
  newer upstream tip rewrites that history and silently replays upstream hunks over fork-owned
  files with no chance to classify them first.
- **No `git cherry-pick` of upstream commits.** Upstream commits mix hunks across files freely;
  a single commit can touch both a file this fork has left untouched and a file this fork has
  turned into a `router-pointer` or `hook-point`. Cherry-picking takes the whole commit or
  nothing — it cannot apply only the safe half.
- Instead: diff upstream file-by-file, classify each changed file via the divergence map, and
  hand-apply (or hand-propose) each hunk.

## Procedure

### 1. Read the ledger

```bash
node scripts/reference-ledger.mjs report
```

The `consumed` column is this run's gate — the ref a previous review actually
finished through, not merely looked at. A repo reading `never` has no recorded
review; choose and record the scope yourself rather than assuming a window, and
see step 3 for where to recover a gate that predates the ledger.

The ledger lives at `../_reference/.sync-ledger.json`, outside this repository,
and is written only by `scripts/reference-ledger.mjs`. `scan` refreshes observed
HEADs and is forbidden from touching `consumed`; only step 7 writes that.

### 2. Refresh the upstream mirror

```bash
cd ../_reference/0_obra_superpowers
git pull --ff-only
git log -1 --format='%H %s'
cd -
node scripts/reference-ledger.mjs scan
```

`--ff-only` is deliberate: the mirror is a plain clone of `obra/superpowers`, never modified
locally. A non-fast-forward result means the mirror was hand-edited or the remote force-pushed —
stop and investigate before continuing. The `scan` afterwards makes `head` reflect the tip you
just pulled.

### 3. Fallback when a repo has no ledger entry

Read the most recent fork release entry in `RELEASE-NOTES.md` for a line of the form
`Resynced the kronflux fork onto the upstream obra/superpowers <version> base (`<sha>`)` — that
`<sha>` is the last-synced ref. (7.0.0's is `d884ae0`, upstream tag `v6.1.1`.) `RELEASE-NOTES.md`
remains the durable historical record and is where the ledger's obra entry was seeded from; the
ledger is the operational index that saves you this lookup on every subsequent run.

If no resync line exists — a mirror added since the ledger landed, or the first sync of a brand-new
reference — there is no ref to recover. Do not invent one. Pick the scope deliberately, say so in
the findings doc, and record the result with `consume` in step 7; from then on the ledger carries
the gate and this fallback is never needed for that repo again.

### 4. Enumerate upstream changes since that ref

```bash
cd ../_reference/0_obra_superpowers
git log --oneline <last-synced-sha>..HEAD                 # what shipped upstream, commit by commit
git diff <last-synced-sha>..HEAD --name-only               # every file touched
git diff <last-synced-sha>..HEAD --stat                    # size, to spot whole-file rewrites vs one-line tweaks
git diff <last-synced-sha>..HEAD -- <path>                  # per-file hunks, once you're ready to classify one
```

### 5. Classify every changed file against the divergence map

For each path in the `--name-only` list, look it up in
[fork-divergence-map.md](fork-divergence-map.md) (Table 1, then Table 2):

| Map lookup result | Rule |
|---|---|
| **Path not in the map at all** | No fork-owned section exists here. Apply the upstream diff directly (`git apply` the hunk, or hand-edit to match). |
| **Path in the map, hunk falls outside every listed fork-owned section** | Apply directly — the touched prose is upstream-shared content the fork has not diverged. |
| **Path in the map, hunk falls inside a listed fork-owned section** (`router-pointer`, `hook-point`, `moved`, `identity`) | Do **not** apply the hunk as-is. Write it up as a proposed change to the corresponding router/adapter/hook file and evaluate it on its own terms — does the underlying behavior change belong in `skills/shared/conductor/*.md`, in a hook script, or does it not apply because the fork's mechanism already solves the same problem differently? |
| **Path is an `overlay` row** (`.antigravity-plugin/`) | Never diff this path directly — it's regenerated. If the *source* skill changed, that's already the router-pointer/net-new row for the source path; after resolving that, rerun `scripts/sync-to-antigravity.sh` once at the end. |
| **Upstream touches a path this fork has deleted** (e.g. `skills/using-superpowers/references/gemini-tools.md`, removed post-Gemini-EOL) | Read the upstream change for informational value only; there is nothing to apply. Note it in the sync's summary so the next person doesn't re-discover the same dead end. |

### 6. Full suite gate

Every applied or proposed change — even a one-line direct apply — gets validated before commit:

```bash
node tests/lint-skills.mjs
npx vitest run
```

Both must exit 0. A proposed router/adapter change that fails a fork-owned test (e.g.
`tests/session-start-payload.test.js` budget, `tests/lint-skills.mjs` dangling-link check) means
the proposal needs rework, not that the test gets loosened.

### 7. Update RELEASE-NOTES and record the new synced ref

Add a dated entry to `RELEASE-NOTES.md` under the next fork version, following the 7.0.0 entry's
shape:

```
Resynced the kronflux fork onto the upstream obra/superpowers <new-version> base (`<new-sha>`).
```

List what was applied directly, what was turned into a router/adapter proposal (and whether that
proposal was accepted or rejected), and what was noted-but-skipped (deleted paths, fork-only
skills with no upstream equivalent). That line is what step 3 of the *next* sync reads as a
fallback, if the ledger entry is ever missing.

Then, and only then, record the consumption:

```bash
node scripts/reference-ledger.mjs consume 0_obra_superpowers upstream-sync \
  --ref <new-sha> --by <fork-commit-sha>
```

`consume` is last on purpose. A sync that stops early — for any reason — leaves `consumed`
untouched, so the next run reads a truthful gate instead of inheriting an optimistic one. This
is the failure the ledger exists to prevent: on 2026-07-26 this playbook itself shipped while
documenting a 51-commit gap in its own worked example, and nothing recorded that the gap was
still open.

Where a review demonstrably completed but the mirror's sha at that moment is unrecoverable,
record the date alone with `--no-ref --date <YYYY-MM-DD>`. Do not substitute a plausible sha.

## Archiving dormant references

A mirror with no upstream commits for five to six months has stopped being a source of new
material; its useful content has already been absorbed. Retire it rather than re-reviewing it
every run:

```bash
node scripts/reference-ledger.mjs archive <name> --reason "no commits in N months"
```

This moves `_reference/<name>` into `_reference/_archive/<name>` and marks the ledger entry
`archived`. Nothing is deleted — the move is reversible with `mv`, and deleting the bytes is a
separate manual decision. `scan` and `report` skip archived entries; the entry itself is kept so
the reason survives.

## Worked example

Grounded in the fork's actual current gap: last synced ref `d884ae0` (upstream `v6.1.1`); upstream
mirror is currently at `3dcbd5c` (`v6.2.0`), 51 commits ahead. One hunk of each class, as it would
be classified today:

**Class 1 — path not in the map.** Upstream's
`skills/systematic-debugging/find-polluter.sh` gained `./`-prefix and `**/`-collapse edge-case
handling for the find pattern. The fork already carries this file (it was copied in before this
playbook existed) but is behind that fix, and the path isn't in either divergence-map table — no
fork-owned section applies to it. Apply directly: pull in upstream's fixed version wholesale,
check whether `skills/systematic-debugging/SKILL.md` needs a reference to it (that file *is* in
the map as `router-pointer` — its Tool Selection paragraph is fork-owned, but a "here's a new
helper script" mention would land outside that paragraph, so it's also a direct apply).

**Class 2 — hunk outside a fork-owned section.** Upstream's `skills/writing-plans/SKILL.md` is a
`router-pointer` row in the map — the only fork-owned part of that file is the one-line Tool
Selection pointer to `skills/shared/conductor/routing.md`. If upstream's actual diff touches, say,
the plan file-naming convention or step-sizing guidance, that's ordinary upstream-shared prose
outside the pointer paragraph. Apply directly.

**Class 3 — hunk inside a fork-owned section.** Upstream's `hooks/hooks.json` is a `hook-point` row
in Table 2, generated wholesale by `scripts/compile-hooks.mjs` from `plugin.universal.mjs` — the
entire file is fork-owned by that generation pipeline, and upstream maintains its own
hand-written `hooks/hooks.json` with a different structure (no `plugin.universal.mjs` upstream at
all). Never copy upstream's `hooks.json` bytes in. If upstream registered a new hook worth having,
write it up as a proposed entry in `plugin.universal.mjs`, run `npm run compile-hooks`, and let
the byte-idempotence tests (`tests/compile.test.js`, `tests/compile-manifests.test.js`) confirm
the regenerated manifests are still well-formed — the proposal is evaluated as a manifest-source
change, not a file-copy.
