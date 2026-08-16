---
title: Match dangerous commands per shell segment, and learn approvals per session
date: 2026-08-14
status: accepted
tags: [adr, safety, hooks]
---

## Context

`hooks/safety/block-dangerous-commands.js` matches ASK-tier patterns against the whole
command string. Across 58 logged `ASK` events, 38 were false positives in three classes:

- 25 or more fired on `git add -A <pathspec>`, which stages only that pathspec. The rule
  treats `-A` as a repo-wide sweep regardless of what follows.
- Several matched inside heredoc bodies, where a commit message of 2,000 characters is
  scanned as command text.
- About three crossed shell boundaries, because `(?:\S+\s+)*` matches `&&`, `;` and `|`.

Both the operator's systems run `"defaultMode": "bypassPermissions"`, which does not
suppress a hook's own `permissionDecision: 'ask'`. Every approval prompt they see comes
from this file, and a 66% false-positive rate trains the operator to approve without
reading — the opposite of the gate's purpose.

## Decision

Strip heredoc bodies and quoted argument bodies, split the command on `&&`, `||`, `;` and
`|`, and match each segment independently. This removes the heredoc and boundary-crossing
classes structurally rather than by regex patch.

Fire `git-add-all` only when `-A` or `--all` is followed by end-of-segment or a redirect. A
following pathspec suppresses the ask, except for `.`, `./`, `*`, `$(pwd)` and an absolute
path equal to the repository root, which are not scoping pathspecs.

Add a `PostToolUse` handler on `Bash` that records an ASK-matched command which actually
executed, into a session allowlist under `spTmp()`. The fingerprint is the exact normalised
command string.

## Options considered

- **Change `(?:\S+\s+)*` to `(?:[^\s;&|]+\s+)*`.** What the defect report proposed. It
  fixes about 5% of the observed noise and leaves the dominant pathspec class and the
  heredoc class untouched.
- **Fingerprint the session allowlist by flag shape rather than exact command.** Rejected
  during the failure-mode check: one mistaken approval of `git add --all` would silently
  authorise every later bulk stage in the session. Fixing the pathspec class already
  removes the repetition that a broader fingerprint would have absorbed.
- **Parse the command with a real shell grammar.** Rejected as disproportionate; segment
  splitting covers the observed corpus and the residual gap is documented.

## Consequences

- Commands wrapped in `bash -c '...'`, `eval`, or a subshell are still not inspected. The
  whole-command regex did not inspect them either, so this is not a regression, but the gate
  should not be described as comprehensive.
- The 58 logged `ASK` commands become a regression corpus. Twenty must still ask; the other
  38 must not. That corpus is the acceptance criterion for any future pattern change.
- The session allowlist means an approval now has a memory. It is scoped to one session and
  one exact command; durable entries require an explicit
  `.superpowers/allowed-commands.json`, written only on request.
