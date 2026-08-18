# Git Hygiene

Shared contract for every skill and subagent that stages, commits, or repairs history.
Referenced by writing-plans and subagent-driven-development; enforced softly by the
bulk-staging permission prompt in `hooks/safety/block-dangerous-commands.js`.

## Staging

- Stage ONLY files you changed for the task at hand, by explicit path:
  `git add src/thing.js tests/thing.test.js`.
- Never `git add -A`, `git add --all`, `git add .`, or `git commit -a` on your own
  judgment. Unrelated local changes (a user's WIP, a stray .gitignore, scratch files)
  are not yours to commit. Bulk staging is legitimate ONLY when the user asked for it.
- Before every commit: `git status` and confirm the staged set is exactly your files.
  If something unexpected is staged, unstage it - do not commit and apologize later.

## Commit messages

Every commit follows [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).
This is required, not a house preference, and the only commit exempt from it is a repository's
first. `hooks/commit-message-gate.js` denies a `git commit` whose inline message does not conform.

```
type(optional-scope): description

optional body, after one blank line

optional footers, after one blank line
```

- **Type** is one of `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`,
  `style`, `test`, lower-case. `feat` is a new capability, `fix` is a defect repair; anything that
  changes neither takes one of the others.
- **Scope** is optional and is a noun naming a section of the codebase: `fix(parser):`.
- **Description** follows the colon and a single space. Imperative, lower-case initial, no trailing
  full stop. The first line is at most 100 characters.
- **Breaking changes** take a `!` before the colon, a `BREAKING CHANGE:` footer, or both. The token
  is upper-case; it is the one case-sensitive element in the specification.
- **Body and footers** each begin one blank line after what precedes them. Lines wrap at 100.
  A footer token uses `-` in place of spaces (`Refs`, `Reviewed-by`), matching the git trailer
  convention.

A comment says what the code **does**. A commit says what **changed**. Neither says what you did to
arrive at either. "History belongs in the commit message" does not mean anything goes there — a
commit describes the change in terms of the software's behavior, not your activity producing it.

| Banned | Instances | Why |
|---|---|---|
| Internal counts | `23 patterns`, `11 categories` | Stale within a week, and describes the implementation rather than the change |
| Planning structure | `per the plan's task 3`, `all eleven categories from the design spec` | Unresolvable to anyone reading `git log` later; scaffolding does not outlive the work |
| Process verbs about yourself | `derive`, `adopt`, `grows`, `iterate on`, `revisit` | Records your motion, not the software's |
| Measurement as achievement | `with measured coverage`, `now fully tested` | Testing is how a change was made trustworthy, not part of the change |

```
BAD:  feat: derive 11-category pattern set with measured coverage
GOOD: feat: detect temporal comparison, troubleshooting anecdote, and ticket references

BAD:  Grows NARRATION to 23 patterns across all eleven taxonomy categories.
GOOD: Comments naming a change and its cause are now detected. Bare sentence-initial verbs stay
      undetected: they cannot be distinguished from present-state usage.
```

State limitations and reasons as properties of the software, not as things you discovered. No
attribution trailers (`Co-Authored-By`, `Generated-with`) unless the user asks.

These four classes are checked in the description and body by the same gate that checks the format.
The matchers are anchored to process narration, so a count or a step number that belongs to the
software passes: `fix: retry step 2 of the OAuth handshake` and `feat: raise the retry limit to 5
attempts` describe behavior and are allowed.

**Gated, not merely reviewed.** A rejected commit reports which rule failed and the required shape.
The gate reads only a message carried in the command, so an editor-driven commit, `--amend
--no-edit`, and `-F <file>` pass through with nothing to inspect. Disabling it in a project is the
user's call and takes an explicit instruction: `touch .superpowers-no-commit-gate`. Do not create
that marker to get a commit through.

## History repair

- A mistaken commit that is LOCAL and UNPUSHED is repaired in place:
  - wrong content or message on the last commit -> `git commit --amend`
  - wrong files swept into the last commit -> `git reset --soft HEAD~1`, restage
    correctly, commit again
  - a bad commit deeper in unpushed history -> non-interactive rebase
    (`git rebase --onto <base> <bad-commit>` to drop it, or
    `GIT_SEQUENCE_EDITOR=true git rebase ...` variants) - and if the surgery is not
    obviously safe, STOP and hand the rebase to the user; agent shells cannot run
    `git rebase -i` (interactive editors hang in a non-interactive shell)
- NEVER stack a new commit to undo your own unpushed mistake. Two wrong commits are
  not a clean history.
- PUSHED history is NEVER rewritten. There - and only there - `git revert` is the
  correct tool.
