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

## History repair

- A mistaken commit that is LOCAL and UNPUSHED is repaired in place:
  - wrong content or message on the last commit -> `git commit --amend`
  - wrong files swept into the last commit -> `git reset --soft HEAD~1`, restage
    correctly, commit again
  - a bad commit deeper in unpushed history -> `git rebase -i`
- NEVER stack a new commit to undo your own unpushed mistake. Two wrong commits are
  not a clean history.
- PUSHED history is NEVER rewritten. There - and only there - `git revert` is the
  correct tool.
