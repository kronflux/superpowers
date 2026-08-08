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

State limitations and reasons as properties of the software, not as things you discovered. Imperative
subject line. No attribution trailers (`Co-Authored-By`, `Generated-with`) unless the user asks.

Reviewed, not gated: a commit-msg hook fires after the work is done and is trivially bypassed.

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
