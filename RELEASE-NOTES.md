# Superpowers Release Notes

## 7.19.0 — conventional commits, enforced

- **A commit message that does not follow Conventional Commits 1.0.0 is refused.** A `PreToolUse`
  gate on Bash reads the message carried in a `git commit` and denies the command when it does not
  parse: a lower-case type from `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`,
  `revert`, `style`, `test`; an optional noun scope; a colon and one space; a lower-case
  description with no trailing full stop, within 100 characters. A breaking change takes `!` before
  the colon or an upper-case `BREAKING CHANGE:` footer. A body or footer begins one blank line
  after what precedes it, wrapping at 100.

  Previously the format appeared only inside examples in `skills/shared/git-hygiene.md` and was
  required nowhere, so conformance varied commit to commit. That file now states the specification
  and drops its claim that a commit message is reviewed rather than gated.

- **The banned content classes are checked, not just documented.** `git-hygiene.md` has listed four
  since it was written — references to the plan or a numbered task, internal counts, measurement
  reported as achievement, and an opening verb describing the author's motion — and nothing
  enforced them. The same gate now matches them in the description and body.

  Every matcher is anchored to process narration, because a gate that refuses correct work gets
  switched off. `fix: retry step 2 of the OAuth handshake` and `feat: raise the retry limit to 5
  attempts` describe the software and are allowed; `feat: add gate per Task 3` and
  `feat: add 11 categories of checks` are not.

- **Only a message present in the command is read.** An editor-driven commit, `--amend --no-edit`,
  `-F <file>`, and `--fixup`/`--squash` supply no text to inspect and pass through rather than
  being guessed at. Heredoc bodies are stripped first, so a command that merely contains commit
  text does not trigger the gate. A repository with no commits passes through, leaving a first
  commit unblocked.

- **Disabling it is the user's decision.** `.superpowers-no-commit-gate` at the project root turns
  it off, matching the decline-marker convention; `git-hygiene.md` states that an agent does not
  create that marker to get a commit through.

## 7.18.0 — the output style installs itself, and rules out verbose prose

### Output style

- **The style is placed automatically.** SessionStart writes `output-styles/signal.md` into the
  active config root when no file of that name is there, so the style Claude Code lists is
  present without a skill being invoked. Previously the plugin shipped the file and never placed
  it, which left `outputStyle` selectable only after running the skill by hand. An existing file
  is never overwritten — once installed, its wording belongs to the operator, and a plugin update
  that silently replaced it would discard that edit with no record. The copy runs inside the
  SessionStart tiering subprocess rather than spawning a second Node process, and absorbs its own
  faults so a failed write cannot alter the payload.
- **Selecting the style is offered during `/onboard`**, not performed. Setting `outputStyle`
  rewrites a settings file the operator owns, so it follows the same ask-then-write shape as
  every other opt-in feature, including the case where a different style is already selected.
- **Signal rules out verbose prose.** Its rules governed sentence and paragraph texture and
  banned specific words, but nothing bounded how much reading a given answer cost, and Brevity
  ranked below a "user intent" clause broad enough to license any expansion. A new Density
  section defines verbosity as reading effort that buys no information — which a paragraph
  carrying four bullets' worth of content incurs at any length — and requires each point be
  stated once, supporting detail be offered rather than delivered, and an answer be sized to the
  question asked.
- **Structure replaces prose wherever an answer has parts.** Headers and bullets carry findings,
  conditions, options and mappings, one idea each; **bold** marks the scan anchor so the bold
  words alone carry the meaning; relationships are shown (`change risk → pre-merge review`)
  rather than narrated. Prose is reserved for a single continuous argument. The pre-send check
  converts any multi-point paragraph to bullets and verifies the bold-only read survives.
- **The explain-fully override requires that the reader asked.** Judging a topic to be important
  no longer grants it. Priority 3 now reads as answering the question in front of you rather than
  the subject it belongs to.
- The output-style skill no longer disclaims an ADHD-summary variant. Those requirements are what
  the density and decidability rules exist to serve, so the disclaimer contradicted the style it
  installs.

### CodeGraph adapter

- **The CodeGraph tool is selected by question shape.** `codegraph_impact` answers a blast-radius
  question transitively in a few hundred bytes and resolves symbols reached only by reference
  (`.map(fn)`), which grep cannot follow; `codegraph_callers` and `codegraph_callees` answer a
  call question directly; `codegraph_search` locates a symbol whose name is not yet known.
  `codegraph_explore` becomes the fallback — it returns tens of kilobytes whether or not the
  answer is in them, and missed six of ten concept-shaped questions across two repositories
  against six of six for locate-by-name on the same questions. Its own tool description
  recommends it over `codegraph_search`, which is where the previous ordering came from.
- The adapter states that a repository's `codegraph.json` governs scope, and that generated or
  minified files admitted there carry enough symbols to dominate `codegraph_explore` ranking
  while leaving `codegraph_search` unaffected.

### Removed

- **`docfork` is gone from the docs-MCP chain, the capability probe, and the statusline.** The
  fallback tier is generic: any configured docs MCP follows the resolve-then-query shape, so
  naming one unmaintained provider as the example bought nothing.
- **The documentation-format conventions name no editor.** Every rule is unchanged and now stated
  as a property of the markdown itself — what renders on GitHub, what grep and `ctx_search` can
  see. Guards in `tests/conductor-removals.test.js` cover `docfork` and bare `obsidian` alongside
  the existing `serena` check.

## 7.17.0 — skill semantics, routing, hook precision, and harness adaptation

### Safety gate

- **A destructive command whose target is quoted is now blocked.** `rm -rf "/"` passed the gate.
  `rm-home` and `rm-home-var` carried `["']?` around their operand and correctly caught the quoted
  form; `rm-root`, `rm-system`, `rm-cwd`, `dd-disk`, `mkfs`, `cat-env` and `git-checkout-dot` did
  not, so a single quote character defeated them. All seven now tolerate quotes. Ordinary cleanup
  is unaffected: `rm -rf ./build`, `rm -rf node_modules`, `rm -f /tmp/scratch.txt` and
  `rm -rf "$PWD/dist"` stay unblocked, because a gate that refuses routine work gets switched off.
- **A dangerous command mentioned inside a heredoc body no longer blocks.** Writing a test fixture
  or a commit message containing `git reset --hard` was refused outright. Heredoc bodies are
  stripped before matching, since a heredoc body is stdin data and can never be argv. Quoted
  arguments are deliberately *not* stripped — several patterns match quoted paths on purpose — and
  the command is deliberately not segmented, because `curl-pipe-sh` requires crossing a pipe to
  match. Both non-transforms carry regression guards.

### Skill semantics

- **Skills declare what they assume, and a repository declares which assumptions hold.** An
  optional `preconditions:` frontmatter list drawn from a closed vocabulary —
  `artifact-cheap-to-modify`, `execution-safe`, `failure-is-cheap` — with
  `.superpowers/domain-profile.json` declaring which hold. An absent or malformed profile means all
  hold, so nothing changes for an existing repository. `test-driven-development` and
  `systematic-debugging` declare `execution-safe` and `failure-is-cheap`, because both silently
  assume a codebase where running the artefact is safe and a failure costs little.
  **Routing states the conflict; it never suppresses the skill** — a repository where running tests
  risks hardware still needs TDD to say so for a genuine bug, and making it unroutable would trade
  a silent wrong assumption for a silent missing skill.
- **Plan step content is conditional on the task's `modelTier`.** `mechanical` keeps the
  complete-code requirement; `standard`, `advanced` and `frontier` require requirements, interfaces
  with exact signatures, and verification obligations, with implementation excluded — writing
  implementation for a design task produced sketches that implementers followed blindly. TBD/TODO,
  vague error handling and undefined-symbol references remain failures at every tier.
- **The complexity tier is re-assessable mid-task.** It was decided once, before work started, from
  the task's description. Four observable conditions now trigger re-assessment: scope past two
  files, a new gate or trigger, a user-visible change, a migration. **Escalation is a decision
  point, not a re-route** — the agent stops, names the condition that failed, and asks whether to
  continue with added gates or re-plan. Routing a finished task back to brainstorming is not the
  behaviour.

### Dispatch

- **Assumptions and Carried constraints are required brief sections**, with an explicit `None`
  permitted. Both were improvised during a long execution run and proved load-bearing — an
  assumptions section caught six false assumptions, and carried constraints prevented later tasks
  silently violating what earlier ones established. Optional sections get skipped precisely when
  they matter, so an explicit `None` forces the author to answer rather than forget.
- **An implementer writes its report to a file as its final action** and returns only a short
  status; the orchestrator reads the file rather than re-prompting. Implementers finished, committed
  and went idle without reporting roughly thirteen times, each costing a round trip to reconstruct
  from git log and diffs. A returned message is compressed by the harness; a file is not.

### Version safety

- **Gate hooks are registered through a version-stable launcher.** `/onboard` wrote absolute paths
  into the versioned plugin cache, so the next bump silently stopped them running — and a gate
  mechanism that stops running looks exactly like one with nothing to report. The launcher resolves
  at runtime: the `installed_plugins.json` registry, then a version-sorted scan, then its own
  directory. An existing pinned entry is migrated in place.
- **A superseded plugin load is announced.** One machine held four cached versions while the
  registry named one. Loading an old version gave no indication, and the symptom — a fix not
  appearing — is indistinguishable from the fix not working. **Pruning is offered, never performed;**
  no directory is deleted.
- Version ordering throughout is semantic, not lexical. With 7.4.0, 7.9.0, 7.15.0 and 7.16.0 on
  disk, collation order selects 7.15.0 and keeps selecting it after an upgrade.

### Hooks stop making false claims

- **The TDD reminder consults the working tree instead of the edit log.** It counted every source
  file the session wrote inside a 30-minute rolling window, resolved against nothing, so read-only
  analysis scripts written to `/tmp` produced "6 source file(s) modified without test changes"
  three times over while the repository's tracked source was untouched — and the window re-reported
  the same batch across later turns. The count is now the intersection of `git status --porcelain`
  with the paths this session edited. A clean tree emits nothing regardless of how many files were
  written; a file written and reverted to its committed bytes drops out; a git failure or a
  non-repository directory stays silent rather than falling back to the old count. Untracked new
  source files do count, since new code with no test is the signal the reminder exists for, so the
  wording is "changed" rather than "modified".
- **The language-server notice says a server is uninstalled rather than nonexistent.** `.py` maps to
  `pyright-lsp`, so "no language server covers this file type" was false wherever it mattered most.
  The two cases are now distinguished and named. The notice still names the decline marker, still
  states that diagnostics never replace a verification gate, and still does not pitch an install.
- **The middleware nudge no longer advises digesting output the agent already holds.** It fired on
  any large failing command output, recommending an external digest of text already in the
  transcript and frequently needed verbatim. A `PostToolUse` payload carries no truncation field, so
  the nudge now requires the harness's in-band output-limit marker and stays silent without it —
  already-in-context and unknown-truncation cannot be told apart, and silence is the safe direction.
  This couples the hook to the current wording of that marker.

### Session payload

- **The model-routing notice is injected at the first subagent dispatch, not at session start.** It
  was appended to every emission wherever a routing config existed, and after payload tiering it had
  grown to roughly 46% of a compacted emission while being relevant only when dispatching. A
  compacted emission with a canonical routing config is now byte-identical to one without: 2,455 B
  either way, down from 3,731 B. Enforcement is untouched — the tier gates read the config directly,
  and a session that never receives the notice still blocks a fence-less plan task. The legacy-config
  migration line stays at session start under its own tag, since it reports a one-time configuration
  decision rather than anything about dispatch.

### Domain profiles

- **A `verification` profile ships alongside the named greenfield default.** The precondition
  vocabulary shipped with no worked example, leaving a repository owner three keys and nothing
  showing what a real profile looks like. `verification` marks all three preconditions unmet and
  suits embedded work, infrastructure with production blast radius, data migration, and regulated or
  scientific code. `artifact-cheap-to-modify` is false because an artefact that cannot be modified at
  all is not cheap to modify. Installing it puts `test-driven-development` and `systematic-debugging`
  in conflict while both stay reachable and invokable; the only automatic effect is that their
  advisory hint is dropped. An absent, unreadable or malformed file means greenfield, which is what
  every existing repository already gets.

### Harness adaptation

This fork does not silence the harness; it removes the reason the harness has to speak. Both changes
below stand on their own and would remain correct if the reminder they address disappeared.

- **The native task list is restored at plan entry.** Multi-step work executed through
  `subagent-driven-development` was tracked only in a plan file, leaving the harness's task list
  empty — in 169 of 337 observed reminder emissions, correctly so, because nothing was tracked. The
  controller now rebuilds the list from `<plan>.md.tasks.json` through the procedure `executing-plans`
  already defines. With no `.tasks.json`, or outside a plan under execution, it creates nothing:
  inventing a task the plan does not record is not tracking. A resumed or post-compaction entry that
  already holds the tasks creates no duplicate.
- **The per-task loop records its transitions on the task.** Updates clustered at pickup and
  completion and went silent through dispatch, review and verification; across 705 measured intervals
  the median gap was 1 assistant message and the maximum 161. The states the skill already names —
  dispatched, implementer returned, under review, verifying — are now recorded as they occur. Issuing
  an update with no real state change behind it is explicitly listed as something never to do, and a
  genuinely atomic step spanning many messages is left alone.

### Recorded, not fixed

- **The lazy-catalog change was not shipped, and its blocker was never tested.** The source report
  proposed replacing the eager skill catalog with a one-line pointer, conditional on first confirming
  that lazy loading does not increase `ToolSearch` pressure inside subagents. That confirmation was
  never run. The routing table was kept for an unrelated reason — payload tiering had already reduced
  the compacted emission enough that the catalog was no longer the dominant cost — so the open
  question stands rather than having been answered.

## 7.16.0 — hook precision, payload economics, and the output style

### Output style and config surface

- **Response shape ships as a native output style.** `output-styles/signal.md` is installed by the
  new `superpowers:output-style` skill into `<configDir()>/output-styles/`, and the selection is
  written to a settings file whose scope you pick, defaulting to user-global. A style is loaded
  into the system prompt: it applies every turn without a skill being invoked, survives compaction
  at no cost, and costs the plugin nothing per turn. The alternative — distributing a style as a
  SessionStart injection, as Anthropic's own `explanatory-output-style` plugin does — was rejected
  for exactly the reason that plugin's README warns about.
- **Four amendments were required before the style could ship**, each resolving a contradiction
  with a skill that runs under it: a five-item list cap that would have truncated review findings
  and test failures; a clarifying-question rule that argued against the five interview-shaped
  skills; a single-recommendation rule that contradicted `brainstorming`'s mandate to propose two
  or three approaches; and no carve-out for machine-consumed structured returns.
- **An existing `outputStyle` is never replaced silently.** The skill reads the current value,
  reports it, and asks. It reports the exact path written in every branch, including when nothing
  changed.
- **`patchSettings` reports what it wrote.** It returned `{ changed: true }` without naming a
  path, so a caller passing a directory already named `.claude` produced
  `.claude/.claude/settings.json` — a file the harness never reads — and a success report. It now
  returns the path in every branch, refuses a nested `.claude` outright, and patches an arbitrary
  top-level key. `loadConfig` gained the config-dir fallback a global install needed and reports
  which path it used.
- **The output contract keeps only what a style cannot carry.** The same rules were stated in
  three places — the style, `skills/shared/output-contract.md`, and this repository's `CLAUDE.md`
  — and drifted independently. The contract shrank to 2,492 B: precedence, ranking, questions,
  relative scope, the no-skill-preamble rule, structured returns, and the dispatch-brief
  requirement. It stays alive for two audiences a style cannot reach: subagents, whose system
  prompt is their agent definition, and the six non-Claude-Code harness overlays this fork ships.
- **Dispatch briefs now carry shape rules.** Measured across 49,895 subagent turns, `Output Style`
  appears 0 times and `output-contract` appears once — neither vehicle reaches a subagent, so
  editing either document could not fix it. `subagent-driven-development` and
  `dispatching-parallel-agents` now require the dispatcher to inline report structure, the status
  line, evidence quoted rather than summarised, and schema-following structured returns.
- **A plan left mid-execution is named at session start.** `~/.claude/tasks/session-*/` is keyed
  by session id, so a restart begins with an empty task list while the durable snapshot sits in
  `.superpowers/plans/<plan>.md.tasks.json`. SessionStart now emits one line naming the plan and
  its open count. It recreates nothing: restoring tasks unbidden into a session about something
  else is worse than the gap it closes.
- **The `ctx_execute` script echo is recorded where routing decisions are made.**
  `skills/shared/conductor/context-mode-adapter.md` states that each call returns the submitted
  script before its output, so a call whose script is longer than its answer costs more than the
  native tool it replaced. The echo belongs to `mksglu/context-mode` and is not configurable from
  this plugin.

### Session payload economics

- **A compaction no longer re-injects the whole skill document.** `hooks/session-start` reads the
  SessionStart `source` field and emits one of two tiers: the full body on `startup` and `clear`,
  and a delimited compact core on `compact`. One measured session carried 403 compaction
  boundaries against 602 payload emissions — on the order of 1.4M tokens spent re-injecting a
  document that never changed, at the point where context is scarcest. `/clear` deliberately
  receives the full body: it wipes the conversation and the user begins new work, so a cleared
  session that skipped the Entry Sequence would lose the fresh-project gate and the memory reads.
  Absent, unparseable or unrecognised `source` also emits the full body, so a harness that does
  not supply the field behaves exactly as before.
- **A repeat emission for the same session and source is suppressed.** Emissions ran at roughly
  1.5 per compaction. A marker under the `sp/` temp root collapses the excess; a `clear` deletes
  that marker before writing its own, so the emission replacing a wiped context is never the one
  that gets suppressed.
- **The payload sheds its coercive framing.** The `<EXTREMELY-IMPORTANT>` block and the Red Flags
  table are gone, replaced by one line: `Override order: user instruction > project context file >
  skill > default.` Both asserted that the agent had no choice but to invoke a skill; across
  389,029 transcript records skills were invoked zero times, so the framing produced conflict with
  project context files rather than compliance. The document falls from 5,185 B to 3,807 B, and a
  compaction now receives 3,511 characters where it received 5,226.
- **`<SUBAGENT-STOP>` is no longer injected.** It stays in the file for a subagent that opens the
  skill through the Skill tool, but the payload reaches 45 of 49,895 subagent turns, so injecting
  it cost every main session ~110 B to guard a path taken 0.09% of the time.
- **Shared-document citations resolve.** 62 citations across 32 skills named `skills/shared/...`
  as a bare relative path, unresolvable by an agent that does not know where the plugin is
  installed. All are now anchored to `${CLAUDE_PLUGIN_ROOT}`, and `tests/lint-skills.mjs` fails on
  a reintroduced bare citation.
- **The questioning rule is stated once.** `brainstorming` required one question per message,
  `token-efficiency` required batching, and `statusline` did neither. `skills/shared/output-contract.md`
  now holds the single rule — batch independent unknowns, ask alone only when the answer changes
  what gets asked next — and the others defer to it.
- **`context-snapshot.json` moves into `.superpowers/`.** The plugin wrote it to the root of every
  project and then appended it to that project's `.gitignore` to hide what it had just written.
  Inside an already-ignored directory neither is necessary, and the `.gitignore` write is gone. A
  root-level file left by an earlier version is removed only when it parses as JSON carrying both
  `generated_at` and `git_hash` **and** git reports it untracked; a tracked file is left alone,
  since staging a deletion the operator did not ask for is worse than the clutter.

### Hook precision

- **Ask-tier git patterns match one shell segment at a time and honour pathspec scope.** Across 58
  real permission prompts in one operator's hook logs, 38 were false positives, the largest class
  being `git add -A <pathspec>` — which stages only that pathspec and is not a repository sweep.
  Heredoc bodies and quoted arguments are stripped before matching, so a commit message is no
  longer scanned as command text, and the command is split on `&&`, `||`, `;`, `|`, `&` and
  newline so a token run cannot cross into the following command. `.`, `./`, `*` and the
  repository root remain non-scoping, so `git add -A .` still asks.
- **A bulk-staging command the operator approved is not asked again in the same session.** Both
  observed configurations run `bypassPermissions`, which does not suppress a hook's own `ask`, so
  every prompt came from this plugin. The allowlist key is the command verbatim: any normalisation
  tried — collapsing quoted bodies, collapsing whitespace — proved content-lossy in a way that let
  one approval authorise a different command. Session-scoped only; entries do not persist.
- **Stop reminders count only source files inside the session repository, and only files the
  session left dirty.** 276 of 500 entries in one edit log pointed at `/tmp` scratch that had never
  been part of any repository, and the commit reminder counted the whole working tree. Containment
  against the session directory replaces extension matching, so a repository checked out under the
  system temp directory — the ordinary CI layout — keeps its own files. Renamed paths are read from
  the `R  old -> new` form rather than treated as a literal.
- **The language-server notice states the diagnostic gap without offering an install.** It still
  names the decline marker and still states that diagnostics never replace a verification gate.
- **A blocking hook explains each rule once per session.** Six tool calls failing the same
  validation emitted the same forty-line explanation six times, burying the only thing that
  differed: which subject failed. Later rejections name the subject and refer back. With no session
  id the full explanation always emits, so the failure direction is verbose rather than silent.
- **`.gitignore` entries are written only inside a git repository.** The helper previously created
  or appended `.gitignore` in whatever directory it was handed. `.git` is a directory in a clone
  and a file in a worktree or submodule, so existence is the test and worktrees keep working.
- **Comment linting covers block and HTML comments, and flags traceability prefixes.**
  `REQ-014: verify the decoder` is a violation; `SHA-256 hashing`, `RFC-3339 timestamps` and
  `UTF-8 - the encoding used here` are not. Position and punctuation separate them, since the token
  shape alone cannot. Docstrings stay out — they carry prose and code samples that read as
  violations without being comments.
- **Activation hints are labelled by measured match strength, not by an authored constant.** A
  `critical` label on a single-keyword match reported a strong match when only the rule's author
  was confident. A match at the confidence floor is now unlabelled at every priority. Hint emission
  and hint-to-invocation conversion are recorded, because the planned suppression engine rested on
  an estimate the transcripts did not support: measured conversion was 0% across 389,029 records,
  and the skill the report named as 54% of hints was 5%.

### Repository layout

- **`docs/` holds committed documentation only.** Plans and specs are produced by *using*
  superpowers rather than placed by a developer, so they move to the gitignored `.superpowers/`
  tree with the rest of a session's working state. `docs/superpowers/` and `docs/plans/` are gone;
  the three developer-placed files under the former move up one level, which removes the collision
  between that path and the local `.superpowers/` tree. The legacy
  `docs/superpowers/model-routing.json` and `workflow.json` fallbacks stay readable for projects
  that still have them — only this repository's own copies were deleted.
- **The worktree path policy test drops three assertions** against a dated design spec and plan.
  Those documents no longer change, so a string being absent from them proved nothing about
  current behaviour; the six assertions against the two live skills are the coverage that can
  still fail.

## 7.15.0 — output and evidence contracts

- **`skills/shared/output-contract.md` governs what a human reads.** Its acceptance test is the
  first and last line: read alone, they must answer what just happened and what needs the reader.
  It carries ranking (without truncating an exhaustive result such as review findings), question
  batching, forbidden language, the pre-send check, and the rule that duration, time of day, and
  suggestions about when the reader should rest or resume never appear — a schedule is the
  reader's to manage, and inferring one simulates an understanding the model does not have.
- **`skills/token-efficiency` no longer defines response shape.** Its rules optimised token cost;
  none addressed whether the reader could act on the result. A response can be dense, filler-free,
  and still impossible to answer. Tool batching, re-read avoidance, and compaction stay; shape
  defers to the output contract.
- **`skills/shared/evidence.md` states what makes a claim about system state admissible.** Reading
  code proves what it says and running it proves what it does; a claim about behavior needs the
  second, against the surface that actually runs, because a test exercising a helper does not
  prove the entry point works. Evidence computed in a subagent or a sandbox exists only once it is
  echoed into the transcript. Seven skills restated that rule in their own words and now link to
  it.
- **Code review leads with the verdict and the finding to fix first.** Strengths follow the issues.
  The two review formats this plugin ships disagreed: one ordered by severity and named a single
  most-important finding, the other opened with praise and placed merge readiness last, where a
  reader who stops early never reaches it.
- **Commit-message rules moved to `skills/shared/git-hygiene.md`**, alongside staging and history
  repair, so they apply in every project rather than only in this fork.
- **Skills no longer open with "I'm using the X skill".** The harness surfaces the active skill, so
  the first line carries the outcome instead.
- **A CodeGraph index is identified by `codegraph.db`, not by a `.codegraph` directory.**
  `~/.codegraph` is codegraph's global settings directory and exists for every user of the tool, so
  the directory alone marked every project as indexed. Detection covers the working directory and
  the enclosing repository root and goes no further: an index found by scanning upward can belong
  to an unrelated project, and answering discovery from another project's graph is worse than
  falling back to grep.
- **Structure discovery and file lookup follow the conductor chain.** `context-management` mapped
  the project with a bare Glob while its neighbouring steps already deferred to the routing chain;
  it now reaches for `codegraph_files` first. `claude-md-creator` declared a `tools:` frontmatter
  allowlist that omitted the ctx and codegraph tools the chain requires.

## 7.14.0 — comment and commit-message discipline

- **Comments state present-state behavior.** What the code does now — inputs, outputs, side
  effects, constraints the code cannot express. Not what was fixed, added, adjusted, or tried;
  not what a review found; not what is temporary or awaiting rewrite. Version control holds the
  history, and a comment describing a change is never updated, so it decays into a claim about a
  past that no longer matches the code. The rule and its examples are in `CLAUDE.md`.
- **Commit messages carry what changed, not how the author got there.** Internal counts and
  planning-document structure do not survive the work that produced them: a reader of `git log`
  in two years has no design document and cannot resolve "category 5" or "all eleven
  categories". Process verbs about the author (`derive`, `adopt`, `grows`) and testing reported
  as achievement (`with measured coverage`) describe activity rather than change.
- `hooks/lib/comment-patterns.js` classifies a comment as present-state description or
  development narration, and distinguishes ordinary vocabulary from violation: `Fixed entries
  have strikethrough`, `Temporary files are written under the sp/ root`, and `Verifies the
  SHA-256 digest` all pass. A bare sentence-initial verb — `Fixed crash on empty payload` — is
  not detected, having no form that separates it from present-state usage.
- The classifier has no caller yet. The `PreToolUse` gate that would deny writes introducing a
  violation, in any project, is not in this release.

## 7.13.0 — SDD workspace defects and an anti-announcement guard

- **The progress ledger is now plan-scoped.** `subagent-driven-development`'s resume
  instruction read a literal `.superpowers/sdd/progress.md` — a file describing whichever plan
  wrote it last. Briefs and review packages became plan-scoped months ago; the ledger was
  missed, and six releases papered over the collision by inventing filename prefixes
  (`v750-`, `v760-`, …) rather than fixing it. The documented command now resolves through
  `sdd-workspace PLAN_FILE`.
- **Stale plan workspaces are reaped by age.** 257 files had accumulated under
  `.superpowers/sdd/`, 102 of them older than a week; nothing had ever removed one.
  `hooks/lib/tmp-reaper.js` now sweeps `.superpowers/sdd/<plan>/` on the same 7-day window and
  the same `SUPERPOWERS_TMP_RETENTION_DAYS` override as the tmpdir sweep, with one exception:
  **a workspace whose plan still has a `pending` or `in_progress` task is never reaped**,
  regardless of age. A plan that goes quiet for a fortnight keeps its ledger.
  This is a deliberate deviation from the `2026-07-06-sdd-plan-scoped-workspace` design, which
  specified deleting the workspace at finish. Deletion at finish destroys reports and review
  packages at the moment they are most wanted — three reporting defects during this release
  were caught only by re-reading reports after their tasks had closed.
- **An unreadable task snapshot no longer means "safe to delete".** `isPlanInFlight` treated a
  torn or malformed `.tasks.json` the same as an absent one. A crash mid-write, a quiet plan,
  and a stale mtime together meant a live workspace was deleted. Absent now means reapable;
  present-but-unreadable means assume live.
- **`TaskUpdate` writes to the plan that owns the task.** `hooks/sync-plan-tasks.js` selected
  the alphabetically-last snapshot rather than the plan being worked. With thirteen snapshots
  present, every update went to one file. It had been correct only by accident, because
  date-prefixed filenames make alphabetical order match chronological order. Selection is now
  by task id; an id in no snapshot is a no-op, and an id in two writes to neither.
- **A Stop hook now catches a turn that promises work and does none.** Announcing "I'll now
  write X" and ending the turn without writing it is the same defect as a report narrating a
  run that never happened. The rule existed in prose and was violated twice in three messages
  while the problem was under discussion, so it is a mechanism now. Patterns are deliberately
  narrow: an early draft blocked 8 of 16 ordinary conversational messages, and a guard that
  fires on normal prose gets ignored, at which point it catches nothing.

Suite: 45 files / 579 passed, up from 43 / 524.

## 7.12.0 — upstream v6.2.0 sync

Resynced the kronflux fork onto the upstream obra/superpowers v6.2.0 base (`44c9b2d`).

- **Windows SessionStart could fail before the polyglot wrapper ever ran.** The generated
  hook command opens with a quoted path — `"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd"
  session-start` — which PowerShell parses as a leading expression and dies on the next
  bareword, and which cmd.exe's quote-stripping can truncate at a metacharacter such as a
  `(` in a profile directory. Both failures happen before `run-hook.cmd`'s polyglot header is
  reached, so it could not catch either. Fixed upstream in `5151e7a` by declaring
  `shell: "bash"` on the hook entry; the fix here required two changes together, since
  `scripts/compile-hooks.mjs`'s `emitClaudeStyle()` copied only `type`/`command`/`async` and
  would have silently dropped a `shell` field added to `plugin.universal.mjs` alone. Recent
  Claude Code (≥2.1.81) auto-detects Git Bash, which is why this was latent rather than
  constant.
- **`scripts/package-codex-plugin.sh` was broken on this machine.** Verified live: `tar -cf -
  --format ustar --uid 0 --gid 0 ...` against GNU tar 1.35 fails with `tar: unrecognized
  option '--uid'` — those are bsdtar-only flags. Now detects GNU tar vs bsdtar and switches
  flag spelling (`--owner=:0 --group=:0 --numeric-owner` vs `--uid 0 --gid 0 --uname ''
  --gname ''`) accordingly.
- **`find-polluter` matched neither `./`-prefixed nor top-level test patterns.** Adopted
  upstream's fix and its regression test (`tests/systematic-debugging/test-find-polluter.sh`);
  the test failed 4 of 5 assertions against the pre-fix script, confirming the bug before the
  fix landed.
- **Plan-scoped SDD workspace: one directory per plan.** `.superpowers/sdd/` used to be flat,
  so two plans' `task-N-report.md` could be the same file. That collided in practice: five
  implementers across two plans opened their report path and found a stale report from an
  unrelated plan, and it happened again while generating briefs for this very sync. Workspaces
  now live under `.superpowers/sdd/<plan-basename>/`, and `review-package` gains a required
  first argument (`review-package PLAN_FILE BASE HEAD [OUTFILE]`) so its output is scoped the
  same way; all seven call sites across five docs were updated to the new signature.
- **`writing-good-tests` replaces `testing-anti-patterns`.** Upstream's rewrite builds on two
  principles — a test must be able to fail for a real production change, and mocks earn no
  assertions — and catches four of the five falsifiability defects this fork actually shipped
  and caught in workstream 1. Two gaps were added as fork content to close the remaining
  cases: a named heuristic for fixture inputs collapsing to a single path (input-diversity
  collapse), and a check for a comment that claims a guarantee the test cannot observe
  (comment-versus-behavior drift).
- **Router-pointer skill compression sweep.** Adopted upstream's compression across eleven
  `SKILL.md` files plus a hand-merge of `finishing-a-development-branch/SKILL.md` around its
  fork-owned pointer sentences and `Hard Rules` section. `subagent-driven-development/SKILL.md`
  was deliberately excluded (see Not taken).
- **Harness-reference refresh.** `skills/using-superpowers/references/gemini-tools.md` now
  documents `invoke_agent`/`generalist` dispatch (replacing the stale `@agent-name` mapping),
  the `GEMINI.md` instructions-file hierarchy, and the expanded tracker tool list;
  `skills/brainstorming/visual-companion.md` gained the Gemini CLI foreground-server snippet.
  `tests/pi/test-pi-extension.mjs` now asserts mapping-table rows instead of matching literal
  tokens anywhere in the file, closing a gap where deleting the table but leaving the prose
  would still have passed.
- **Two corrections to our own sync documentation.** `docs/superpowers/upstream-sync.md` cited
  `skills/using-superpowers/references/gemini-tools.md` as a worked example of "upstream
  touches a path this fork has deleted" — that file is live, imported by `GEMINI.md`, and was
  deliberately ported back during the 7.0.0 resync; the false example is replaced with a
  statement that no such deleted-path example currently exists in this fork.
  `docs/superpowers/fork-divergence-map.md` gained an entry for
  `skills/using-superpowers/references/antigravity-tools.md`, which had diverged into an
  independently written, materially richer document with no map entry flagging that — a future
  sync would otherwise have applied upstream hunks directly and destroyed fork content. A
  related false claim (that upstream's harness-reference siblings were fork-deleted) was found
  and corrected in the same area.

**Not taken.** Six items from the upstream range were deliberately left out:
- `skills/subagent-driven-development/SKILL.md` — upstream's 541-line lifecycle restructure
  collides with fork-owned `Parallel Waves (guarded)` and `Task Persistence Sync` sections and
  needs its own spec, not a sync hunk.
- `re-review-prompt.md` — reverses a decision this fork's own
  `specs/2026-06-09-sdd-task-scoped-review-dispatch-design.md` rejected with cited evidence.
- `implementer-prompt.md` — its "will be resumed with the findings" wording describes a
  mechanism this fork's documented controller does not have.
- `codex-tools.md` — describes the resume-based fix loop this fork has not adopted.
- `tests/antigravity/test-antigravity-tools.sh` — upstream deletes assertions that are still
  true for this fork's richer `antigravity-tools.md`; applying it would delete valid coverage.
- `tests/codex/test-package-codex-plugin.sh` — upstream's version needs `python3`, which this
  machine lacks only a non-functional Microsoft Store stub of.

## 7.11.0 — plan task snapshots that tell the truth

- **`hooks/sync-plan-tasks.js` keeps `<plan>.md.tasks.json` in sync.**
  `subagent-driven-development` has documented a "Task Persistence Sync" step since the skill was
  written — after each `TaskUpdate`, write the new status through to the snapshot so a resumed
  session sees real state. No controller has ever performed it: 9 of the 11 snapshots in this
  repo still read `0/N`, including plans that were fully executed and merged weeks ago. Prose
  asking a controller to remember something on every tool call is not a mechanism; a
  `PostToolUse(TaskUpdate)` hook is. Two things silently depended on that file: cross-session
  resume, which reads it to find remaining work and would re-dispatch tasks already done, and
  the statusline's plan segment, which rendered a permanent `plan 0/N`. `deleted` is deliberately
  not synced — dropping an entry would shrink the denominator and make a resumed plan look
  shorter than it is. An id the plan does not contain leaves the file byte-identical, since
  sessions run native tasks unrelated to any plan.
- **Session token usage is read from a 256KB tail, not 16KB.** At roughly 153 bytes per record
  the old window covered about 107 records, so a busy session undercounted and the displayed
  total could visibly *decrease* as records scrolled out. The new bound holds roughly 1,700
  records and is documented at the call site.
- **`scripts/statusline.mjs` no longer runs on import.** `main()` was called at module scope, so
  importing the renderer for a test or a wrapper drained stdin and printed a line. It now guards
  on being the entry point and exports `render` and `sanitizeLineValue`.
- **The statusline install refuses to overwrite valid-JSON non-objects.** The guard caught parse
  failures but not `"str"`, `[]`, `null`, `42` or `true`, which parse fine: `"str"` threw an
  uncaught `TypeError` on property assignment, and `[]` accepted the property only to lose it to
  `JSON.stringify` — reporting a successful write that never landed. A settings file that is
  valid JSON but not an object is no more safely overwritable than a malformed one; both are now
  reported as `unparseable` and left alone.

## 7.10.0 — conductor statusline

- **`/superpowers:statusline`** installs a conductor statusline: active capabilities, the last
  model-routing dispatch, plan progress, and session token usage, rendered by
  `scripts/statusline.mjs` from config at `.superpowers/statusline.json`. A plugin cannot ship
  the `statusLine` setting itself — only `agent`/`subagentStatusLine` — so this interview is the
  only way the statusline reaches a user; it writes the setting into their own
  `.claude/settings.json`. Two modes: the default emits only conductor segments for a
  ccstatusline Custom Command widget; `--full` prefixes model name and context-window
  percentage and needs no third-party install.
- **Version-stable launcher.** The interview copies `scripts/statusline-launcher.mjs` to the
  active config root, outside the versioned plugin directory, and `settings.json` points there
  instead of at a versioned plugin path. The launcher re-resolves the highest installed plugin
  version's `scripts/statusline.mjs` on every invocation, so a plugin update never breaks the
  pointer.
- **Fail-silent by design.** Renders on every assistant message, so the renderer never throws
  past its top-level handler — any internal fault prints an empty line and exits 0 rather than a
  stack trace across the prompt line.
- **Gitignore honesty.** The install step reports which of four states it hit for `.claude/`:
  already covered; a rule added; already tracked by git; or the check was inconclusive. In the
  tracked case a `.gitignore` rule cannot untrack the path, so nothing is written and `git rm
  --cached -r .claude` is offered as the user's own decision, never run automatically. In the
  inconclusive case the `git ls-files` probe itself failed against a real repository — nothing is
  written and the install says so, rather than claiming a rule was added when the directory may
  still be tracked.
- **Scope note: middleware-exec runs are not represented in the delegation segment.**
  `scripts/middleware-exec.mjs` is a standalone CLI spawned from Bash with no session in scope,
  so its usage records carry no session identity to match against the statusline's session.
  Bounding its records by a time window would mis-attribute exactly when two sessions overlap.
  Middleware cost stays reported in `/superpowers:usage`.
- Does not install or configure ccstatusline itself; the interview only prints how to point its
  Custom Command widget at the launcher.

## 7.9.0 — runtime artifact hygiene

- **Every plugin tmpfile now lives under `<tmpdir>/sp/`** and is named via `spTmp()`. Measured
  before this change: 302 of 570 temp entries were ours, across five hook writers and the test
  suite.
- **Reaping.** SessionStart sweeps entries older than 7 days (`SUPERPOWERS_TMP_RETENTION_DAYS`,
  `0` disables), throttled to once per 24h and riding an existing hook so session start gains no
  process spawn. SessionEnd clears the ending session's ephemeral state immediately — but never
  the usage offset, and not at all on `reason: "resume"`, since both would corrupt the
  append-only usage log for a session that comes back.
- **The test suite stopped leaking.** `tests/safety-hooks.test.js` created a directory per hook
  invocation and removed none — 133 of the 302. A full `npm test` now leaves a net-zero delta.
- **`tests/tmp-namespace.test.js`** fails on any bare `os.tmpdir()` call outside the helper, so
  the sprawl cannot regrow.
- Aged pre-migration flat `sp-*` names are cleaned once by an exact, time-boxed prefix list.

## 7.8.1 — LSP detection actually works

- **Fixed: the `lsp` capability detected nothing for any official language server.** The probe
  looked only for a plugin-local `.lsp.json` or `plugin.json.lspServers` — the layouts the
  plugin-authoring docs describe. Every plugin installed from a marketplace declares
  `lspServers` on its entry in that marketplace's `.claude-plugin/marketplace.json` instead,
  leaving only `LICENSE` and `README.md` in the install directory. `lspExtensions()` now reads
  both layouts and unions them, so a profile mixing hand-authored and marketplace plugins is
  fully covered. Verified against a real `/plugin install typescript-lsp@claude-plugins-official`:
  the probe now reports `configured` with `.cjs .cts .js .jsx .mjs .mts .ts .tsx`.
- Regression tests are built from the real on-disk marketplace layout. The 7.8.0 fixtures
  encoded the assumed layout, so the probe read back exactly what the fixture wrote and passed
  while detecting nothing in the field.

## 7.8.0 — conductor surface correction

- **Serena removed.** The symbol-precise-edit row is now CodeGraph blast-radius → context-mode
  search → native Edit. `skills/shared/conductor/serena.md` deleted.
- **Obsidian tooling removed, conventions kept.** `obsidian.md` → `doc-format.md`; every
  authoring convention retained, the vault-tooling section and the `obsidian-cli` /
  `basic-memory` probes deleted.
- **New `lsp` capability.** Detects language-server coverage from installed plugins and offers
  the matching official plugin once per session (decline is tracked per language, in
  `.superpowers-no-lsp`). Diagnostics are documented as a non-authoritative fast signal that
  never replaces a verification gate.
- **CodeGraph init offer now fires.** New `codegraph-init` nudge class; the previous
  `indexed === true` guard filtered out exactly the repos the offer targets.
- **Usage attribution** stops emitting `serena` and `obsidian` keys; logs written before 7.8.0
  keep theirs and still render.

**Manual follow-up:** removing these references does not close the Serena dashboard. Run
`/plugin uninstall serena@claude-plugins-official` and delete any leftover `.serena/` directory.

## 7.7.0

- **Usage collection no longer dies on large sessions** — the Stop-hook aggregator read the
  entire unread transcript region into one string, which throws past V8's ~512 MB string cap.
  The exception landed before the byte offset was saved, so every later turn retried from zero
  and failed identically, silently, forever. Reads are now bounded chunks, first-sight backfill
  on an already-huge transcript is capped, and the offset always advances so no input can stall
  the collector.
- **Conductor usage is attributable** — per-capability call counts and result bytes (codegraph,
  serena, context7, obsidian, middleware) are recorded alongside token deltas and reported by
  `/superpowers:usage`. Bytes measure context consumed by tool results; the token figure is an
  estimate, since MCP results land inside the main session's token count.
- **A dead collector now announces itself** — `hooks-logs/usage-aggregator-health.json` records
  every run, keyed by `sessionId`, and `/superpowers:usage` leads with a warning when collection
  has failed or stalled. Stall detection is a `lastRunAt` staleness check, not an offset
  comparison: a single overwritten health record cannot express "offset unchanged since the
  previous record," so an `offset` trailing `transcriptSize` is normal chunked catch-up, not a
  fault. `/superpowers:usage` also computes session totals from the durable per-turn log rather
  than `session-stats.json`, which is config-root-wide and expires after two hours.

## 7.6.0 — conductor activation, usage announcements, git hygiene

Three improvements in tool-selection nudging, external model attribution, and explicit staging practices.

### Conductor nudges

A new fail-open hook fires one tip per capability class per session at the moment of tool choice: CodeGraph-indexed repos on Grep/Glob/Read, Serena on first Edit, middleware digests on large failing Bash output. The session-start `[conductor]` line is now directive (`use first:`). No auto-execution: middleware runs stay an explicit, announced choice.

### Usage in announcements

External delegation announcements must carry the run's token cost (byte counts for CLI transports) from the `[middleware] done` banner.

### Git hygiene

Bulk staging (`git add -A`/`.`, `git commit -a`) now raises the native permission prompt instead of passing silently; `skills/shared/git-hygiene.md` sets the explicit-path staging and history-repair contract (amend/rebase unpushed mistakes, never stacked undo-commits, never rewrite pushed history).

## 7.5.0 — routing reliability, path consolidation, visibility, and token usage

Four improvements across dispatch routing, project paths, conductor visibility, and usage tracking.

### Chronological dispatch-gate scanner

A task's description now resolves to the latest transcript event, fixing frontier-consent fences shadowed by stale TaskUpdate descriptions on reused task ids. New consent-fence mechanics section in `docs/model-routing-flow.md`.

### .superpowers is the canonical project config dir

`model-routing.json` and `workflow.json` resolve `.superpowers/` first; legacy `docs/superpowers/` stays readable with a logged notice and a session-start migration offer. User-level paths unchanged. `/onboard` writes canonical paths and checks `.superpowers/` is gitignored first.

### Conductor visibility

`[middleware]` start/done stderr banners with duration and usage; `[conductor]` delegation announcements mandated in the conductor contract; every routed dispatch decision recorded in `hooks-logs/routing-dispatch.log`.

### Token usage reporting

Middleware HTTP requests log exact prompt/completion tokens (CLI transports log byte sizes) to `hooks-logs/middleware-usage.jsonl`; a new Stop hook aggregates the session's own transcript usage into `session-stats.json` and `hooks-logs/claude-usage.jsonl`; `/superpowers:usage` renders the report.

## 7.4.0 — middleware CLI transport

`middleware-exec` gains a second transport: local CLI agents (`agy`, `opencode`, `claude`) are
now usable as middleware providers alongside the existing HTTP path. Proven end to end by
executing the real entry point against a fake CLI endpoint — see the release proof in
`.superpowers/sdd/task-7-report.md`.

### Two transports

`transport` defaults to `"http"`, so every existing config keeps working with no edit. A CLI
endpoint declares either a verified `preset` or a free-form `command` argv array.

### Presets, from recorded invocations

- `agy` — argv delivery, `--model`. `agy` cannot take stdin: its `-p` flag fails argument
  parsing without a value, so argv is the only viable delivery mode.
- `opencode` — stdin delivery, `-m`, with the model flag placed under its documented `run`
  subcommand.
- `claude` — stdin delivery, `--model`.

Defaults were set from recorded invocations of each real binary, not assumption.
`codex` and `gemini` get no presets — neither is installed on the development machine, so
their invocations could not be verified and guessing flags was not acceptable. Both are served
by the free-form `command` shape. The 7.3.1 Google/Gemini HTTP endpoint remains the way to
reach Gemini over HTTP.

### Delivery and limits

`input_mode` is `argv` (prompt substituted into an `{{prompt}}` placeholder) or `stdin`.
`max_argv_bytes` (default 30000) returns exit 3 with a suggestion to switch to stdin, rather
than truncating the prompt silently. `timeout_ms` (default 120000) kills the child.

### Security posture

Commands spawn with `shell: false` as an argument array, so nothing in a prompt can start a
subprocess or chain a command. In argv mode, though, the prompt still reaches the target CLI's
own argument parser — a leading dash may be read as a flag. Presets minimize this; hand-authored
`command` configs should avoid bare positionals. Naming a binary in config is a code-execution
surface, but it introduces no new trust tier: `.claude/settings.json` already runs arbitrary
hook commands.

### Agentic-tool isolation

CLI providers carry their own file and shell tools, so every run spawns in a fresh temporary
working directory that is removed afterward, keeping any writes the CLI makes out of the
project.

## 7.3.1 — onboarding correctness fixes

Three fixes, all found by running `/onboard` end-to-end against a real profile environment
rather than by inspection.

### Middleware detection under a custom config root

`hooks/lib/capability-registry.js` probed for `middleware-config.json` in only two locations
(project `.claude/` and `~/.claude/`), while `scripts/middleware-exec.mjs` resolves three —
project, `$CLAUDE_CONFIG_DIR`, then legacy home. Under a custom config root, `/onboard` wrote a
valid config to the profile root that the probe could never see: middleware reported `absent`
forever, the conductor treated it as unavailable, and every subsequent `/onboard` re-offered it.
The probe now uses the same candidate chain as the executor. Regression test pins both `HOME`
and `CLAUDE_CONFIG_DIR` to scratch dirs and fails against the old code.

### Serena memory exclusion is now unconditional

The `.serena/project.yml` memory-tool exclusion was written only inside the "yes" branch of an
install offer that fires only when Serena is `absent`. Anyone who installed Serena *before*
onboarding — the common case — silently never got it, leaving Serena's own memory tools live
alongside the four-layer superpowers memory that `skills/shared/conductor/serena.md` marks as a
STRICT PROHIBITION. The exclusion is now an unconditional step that runs ahead of the offer,
whatever Serena's detected status, and the offer no longer duplicates it.

### Google/Gemini provider example

`docs/superpowers/middleware-config.example.json` gains a `google` endpoint —
`https://generativelanguage.googleapis.com/v1beta/openai/`, model `gemini-3.6-flash`, key env
`GEMINI_API_KEY`. Verified against Google's own OpenAI-compatibility documentation; it needs no
code change because it authenticates with `Authorization: Bearer`, which `middleware-exec`
already sends. The unconfigured-error message also now names all three search paths instead of
two.

## 7.3.0 — four-tier model routing with gated frontier

Model-tier routing expands from three tiers to four: `mechanical` / `standard` / `advanced` /
`frontier`. `advanced` (Opus-class) is the new default ceiling, carrying the old top-tier
semantics unchanged. `frontier` (Fable-class, 2x cost) is a new, optional tier — off by default,
and gated per task when enabled.

### Four-tier config schema

- `hooks/lib/routing-config.js` returns one normalized four-key object regardless of input
  schema, so no downstream consumer branches on schema version. `routing.frontier` is a model
  name, `'inherit'`, or `'off'`.
- Legacy three-key configs (`mechanical`/`standard`/`frontier`) keep working unchanged: the old
  `frontier` key is normalized to `advanced`, and the new `frontier` key defaults to `off`.
  Proven by direct execution of the loader against a legacy config — see the release proof in
  `.superpowers/sdd/task-7-report.md`.
- A legacy config that maps its `frontier` key to a Fable model is rejected as ambiguous rather
  than silently promoted to the new frontier tier; when frontier is enabled it must name a model
  different from `advanced`.

### Consent-gated frontier dispatch

- The plan gate (`hooks/pre-taskcreate-model-tier.js`) rejects `modelTier: "frontier"` when the
  tier is off.
- `writing-plans` carries a frontier offer contract: why this task, the 2x cost, the `advanced`
  counter-case, and `advanced` as the default. `hooks/pre-agent-model-routing.js` enforces it at
  dispatch with a two-signal check — a fence token plus an `AskUserQuestion` answer, both present
  in the transcript.
- Honest limit, stated in `docs/model-routing-flow.md`: the gate guards the careless path, not a
  deliberately adversarial agent with Bash access.

### Session notice and onboarding

- `hooks/session-start` now honors `CLAUDE_CONFIG_DIR`, fixing a mismatch where the notice could
  read a different config file than the one hooks enforce under a profile environment.
- `/onboard` writes the new `schema: 2` config, offers `frontier` as an explicit opt-in (default
  off), and no longer offers a Fable flat cap.

### Docs

- ADR: `docs/adr/2026-07-28-four-tier-model-routing.md`.

### Breaking changes

- None. Legacy three-key configs are normalized at load with identical routing behavior. This
  includes the `modelTier: "frontier"` fence value in pre-7.3 plan tasks: under a legacy config
  it is aliased to the old top tier (now `advanced`), not treated as the new gated tier.

## 7.2.0 — config-dir isolation

Superpowers works out of the box in any Claude Code environment. Custom config roots
(`CLAUDE_CONFIG_DIR`, multi-profile launchers such as `ccw`) are now first-class; standard
single-profile installs are unchanged. Nothing is ever written outside the active config root.

### Shared config-root resolver

- **`hooks/lib/config-dir.js`** — single `CLAUDE_CONFIG_DIR`-aware resolver, adopted uniformly
  across capability detection, model-routing config, middleware-exec config, and all ten hook
  telemetry log roots. Precedence is consistent everywhere: project path → active config root →
  `~/.claude` legacy fallback.

### Plugin-aware capability detection

- `hooks/lib/capability-registry.js` now detects `/plugin-installed` MCP servers (via
  `installed_plugins.json` plus each plugin's own `.mcp.json`, gated on enabled state) alongside
  the active root's `.claude.json`. Fixes a false-negative where plugin-provided servers (e.g.
  Serena, Context7) were invisible to the probe under a non-legacy config root.
- Obsidian detection fixed to accept either the `obsidian` or `obsidian-cli` binary.

### Model routing

- `routingSource()` exposes which candidate path satisfied `loadRouting()`, logged on a
  fail-open basis for diagnosability. Candidate precedence follows the shared resolver.

### `/onboard` rework

- Plugin-first install offers: `serena@claude-plugins-official` and
  `context7@claude-plugins-official` are offered as verified marketplace plugins (Serena's
  README tension with the memory-tool prohibition is disclosed up front).
- New middleware-exec education section — what it is, why it exists, its cost, and how to
  configure it.
- All write targets are config-root-aware; probe-primary detection wording clarified.

### Hook registration

- **`scripts/resolve-plugin-script.sh`** — version-resolving shim so hook registration doesn't
  hardcode a plugin version directory.
- Registration docs updated to recommend `$CLAUDE_CONFIG_DIR`-first paths, with Windows-specific
  notes.

### Docs

- Probe-primary capability-detection docs and the profile-scoped routing contract documented in
  `CLAUDE.md`, `AGENTS.md`, and `docs/ARCHITECTURE.md`.

### Test hardening

- Hermetic test-env fixes across the capability-registry, middleware-exec, model-routing, and
  hook-telemetry suites — `CLAUDE_CONFIG_DIR` is stripped so suite behavior no longer depends on
  the ambient environment.

### Breaking changes

- None. Standard, single-profile installs behave exactly as before; every code path added this
  release is additive and fails open to prior behavior when no custom config root is present.

## 7.1.0 — the conductor

Introduces the Conductor: a central tool-selection layer that routes skill work to external
capabilities (CodeGraph, Serena, Context7, middleware-exec, Obsidian) when present, and falls
back to native tools otherwise. **Governing principle: every integration is optional —
capability-gated, never required, never skipped when present.**

### Conductor module

- **`skills/shared/conductor/`** — `routing.md` is the central tool-selection authority; a job
  taxonomy table maps job types (macro discovery, symbol-precise edit, external docs, output
  handling, mechanical work, memory/ADR persistence) to a chain of capabilities, first available
  wins. Skills defer to it via one canonical sentence instead of restating routing rules.
- **Five adapters**, one per capability: `codegraph.md` (macro discovery, blast-radius tracing),
  `serena.md` (symbol-precise edits; its memory tools are under a strict prohibition — the
  four-layer memory + ADR layer is the sole memory system), `context7.md` (external framework/API
  docs), `middleware.md` (mechanical subagent work), `obsidian.md` (memory/ADR persistence in
  Obsidian-valid markdown). The pre-existing `context-mode-adapter.md` is migrated into the
  directory as the output-handling adapter.

### Capability probe

- **`hooks/lib/capability-registry.js`** detects each of the five capabilities as `absent` or
  `configured` at session start, with decline markers so a user's "no" persists across sessions.
  A `[conductor]` summary line is added to the SessionStart output and to `context-snapshot.json`.
  A tool becomes `verified` after its first successful call in a session; any failure demotes it
  for the rest of that session, silently, down the chain.
- SessionStart payload cap raised to **5,232 B** (measured payload: 5,212 B) to carry the summary
  line.

### middleware-exec

- **`scripts/middleware-exec.mjs`** — a CLI for routing mechanical work (log digests,
  boilerplate) to a swappable OpenAI-compatible endpoint, configured via
  `docs/superpowers/middleware-config.example.json`. Falls back to the existing methodology on
  any non-zero exit. Endpoint keys are read from environment variables only, never written to
  config files.

### ADR layer

- A `docs/adr/` convention for architecture decision records. `brainstorming` reads and writes
  ADRs. Formats are Obsidian-valid per `conductor/obsidian.md` — a comparative Obsidian Flavored
  Markdown adoption that works whether or not Obsidian is installed.

### Routing and dispatch

- **3-tier complexity routing** (micro/lightweight/full) in `using-superpowers`, adapted from
  the REPOZY audit (`EnterPlanMode` handling excluded).
- **SDD dispatch matrix** in `subagent-driven-development`.
- **Failure digests** added to `test-driven-development` and `systematic-debugging`.
- **Strict skill lint** — `tests/lint-skills.mjs` now checks for dangling cross-skill links, a
  duplication guard, and enforces the existing byte budgets.

### `/onboard` extensions

- Guided, clone-verified install offers for CodeGraph, Serena (with the memory-tool exclusion
  called out explicitly), Context7, middleware-exec, and obsidian-cli. Never auto-runs an
  install; every offer can be declined, and declines are remembered.

### Upstream-sync playbook

- `docs/superpowers/` gains a review-and-apply playbook for pulling upstream changes and a
  fork-divergence map, documenting where and why this fork's behavior diverges from
  obra/superpowers.

### Fixes

- **brainstorming** — presentation now follows a standalone-message rule, decoupling design
  presentation from the surrounding conversational flow.

### Breaking changes

- None for end users. Every new integration is opt-in and inert until a capability is detected
  or a user runs `/onboard`.

## 7.0.0 (kronflux fork)

Resynced the kronflux fork onto the upstream obra/superpowers v6.1.1 base (`d884ae0`) and
re-adapted the fork's divergent feature set as clean commits on top, plus net-new capabilities.

### Re-adapted subsystems

- **Context-mode integration.** Skills, hooks, and memory route data work through the
  context-mode `ctx_*` tools when active; native fallback otherwise. Single source of truth:
  `skills/shared/context-mode-adapter.md`.
- **Safety hooks.** PreToolUse blocking of dangerous commands and secret exposure, fail-open.
- **Output compression.** Bash output compression that yields when context-mode owns Bash routing.
- **Opt-in verification gates.** Seven task-gate hooks under `hooks/examples/`, off by default.
- **Coexistence contract.** `sp-*` tmpdir namespace, no `PreCompact`, WebFetch owned by context-mode.

### Net-new in 7.0.0

- **Model-tier routing** — opt-in `docs/superpowers/model-routing.json` enforced by three
  PreToolUse gates and a session notice.
- **`/onboard` command** — sets up model-tier routing and fork configuration.
- **Universal hook manifest** — `plugin.universal.mjs` compiled by `scripts/compile-hooks.mjs`
  into all three hook manifests; byte-idempotence enforced by test.
- **Context economy** — SessionStart payload 5,165 B (~1,290 tokens, ≤5,200 asserted); 27 skill
  descriptions 5,441 B total (≤300 B each, lint-enforced); always-on floor ~2,650 tokens, down
  from ~6,330 (~58% measured reduction).
- **Antigravity overlay** — `.antigravity-plugin` surface synced by `scripts/sync-to-antigravity.sh`.
- **Four-layer memory architecture** — auto-capture → `state.md` → durable artifacts → harness
  memory, documented in `docs/ARCHITECTURE.md`.
- **Local-by-default session artifacts** — plans, specs, and `.tasks.json` written by
  brainstorming/writing-plans now default to the gitignored `.superpowers/` scratch dir and are
  never committed to the project being worked on unless explicitly requested.

### Breaking changes

- None for end users.
- For maintainers: `hooks/*.json` are now **generated** from `plugin.universal.mjs` — never
  hand-edit them; run `npm run compile-hooks` after editing the manifest source.

## 6.x fork line (retrospective)

Correcting the record for the pre-resync fork history: upstream's own 6.x release notes describe
`commands/` and `agents/` as removed, but **this fork re-added both** and carried them forward.
The fork's 6.x line also shipped the initial **context-mode integration**, the **safety hooks**,
and the **opt-in gate workflow** — all of which are re-adapted and preserved in 7.0.0 above.

## v6.1.1 (2026-07-02)

### Codex

- **Codex no longer re-registers the Claude SessionStart hook.** v6.1.0 removed the Codex hook config and its manifest `hooks` pointer, meaning to stop Codex from installing a SessionStart hook — but with no `hooks` field, Codex fell back to auto-discovering `hooks/hooks.json`, the Claude Code SessionStart hook that the marketplace ships from the repo root, and re-registered it along with its install-time trust prompt. The Codex manifest now declares an explicit empty hooks object (`hooks: {}`), which Codex reads as "no hooks" instead of reaching the auto-discovery fallback. An absent field, `[]`, and an empty inline list all collapse back to the fallback, so the value has to be exactly `{}`.
- **Removed orphaned Codex session-start dead code.** `hooks/session-start-codex` had no caller once the Codex hook config was deleted, so it and its redundant test cases are gone. The worked shell-hook example in `docs/porting-to-a-new-harness.md` moves from Codex — now native skill discovery with no session-start hook — to Cursor, a live shell-hook harness, and the stale `hooks-codex.json` pointer in `docs/windows/polyglot-hooks.md` is corrected. The Codex plugin category is also fixed to "Developer Tools".

### Packaging

- **New `package-codex-plugin.sh` for building the Codex portal package.** A maintainer script produces a deterministic Codex "portal" archive — `.zip` by default, `tar.gz` on request — that normalizes entry timestamps, preserves executable modes, verifies every packaged skill ships its OpenAI metadata, includes the app and composer icons, and refuses to run against a dirty worktree. The packaged manifest keeps the source `hooks: {}` object so a portal-installed plugin avoids the same SessionStart auto-discovery, and the script can rebuild a byte-identical archive from a saved metadata source. Covered by a new test suite.

## v6.1.0 (2026-06-30)

### Lower Per-Session Token Cost

The `using-superpowers` bootstrap is injected into every session, so its size is paid for constantly. This release trims it and the per-harness references it points to, without dropping behavior-shaping content.

- **Compressed the `using-superpowers` bootstrap.** Replaced the graphviz skill-flow diagram with the prose it encoded, folded the standalone Instruction-Priority section into User Instructions, dropped the per-platform "How to Access Skills" walkthrough, and trimmed the Platform Adaptation pointer to the harnesses that still ship a reference file. The full Red Flags rationalization table and the user-instruction precedence rules are unchanged.
- **Pruned the per-harness tool-mapping references.** The verbose action-to-tool tables restated guidance modern agents already follow. Each reference file is trimmed to the harness-specific notes that still carry weight — subagent dispatch, task tracking, instructions-file paths — and `claude-code-tools.md` and `copilot-tools.md`, which had nothing harness-specific left, are deleted.

### Codex

- **Codex can install from the marketplace.** Codex marketplace sources expect a `.agents/plugins/marketplace.json` at the marketplace root; the repo only shipped the Claude marketplace file, so Codex could name the marketplace but found no installable plugin entries. A repo-local Codex marketplace manifest now points at the same repository root, so the plugin is installable from Codex.
- **Codex no longer ships a SessionStart hook.** Codex reliably triggers skills on its own, and the bootstrap hook made the UX worse rather than better. The Codex hook config (`hooks-codex.json`) and its manifest registration are removed.

### Harness Support

- **Gemini CLI support removed.** Google EOLed the Gemini CLI on 2026-06-18; the extension can no longer be installed or updated. Gemini is gone from the install docs, the subagent-capable platform lists, and the eval-harness description, and its tool-mapping reference is deleted.

## v6.0.3 (2026-06-18)

### Subagent-Driven Development

- **SDD scratch files moved out of `.git/`.** Claude Code treats `.git/` as a protected path and denies agent writes there, so an implementer subagent writing its report into `.git/sdd/` got blocked mid-run. Task briefs, implementer reports, review diffs, and the progress ledger now live in a self-ignoring `.superpowers/sdd/` directory in the working tree — kept out of `git status` and out of commits, and resolved per worktree by a shared `sdd-workspace` helper. One caveat: because the workspace is git-ignored working-tree scratch, `git clean -fdx` will delete the progress ledger; recover from `git log` if that happens. (#1780)

## v6.0.2 (2026-06-16)

### Install Fixes

- **We no longer ship the `evals` submodule.** It broke plugin installs for some users, so the eval harness now lives in its own repo, separate from the published plugin. (#1778, #1774)

## v6.0.1 (2026-06-16)

### Codex Fixes

- **Version display in the brainstorm companion** — packaged Codex plugins ship without a root `package.json`, so the visual companion reported its version as "unknown". `readSuperpowersVersion()` now falls back to `.codex-plugin/plugin.json` when `package.json` is absent.
- **Cleaner Codex plugin sync** — the sync-to-codex script now excludes `.gitmodules` and `.pre-commit-config.yaml`, keeping repo metadata out of the packaged Codex plugin.

## v6.0.0 (2026-06-16)

Superpowers 6.0 is a big release. The headline is a rewrite of how `subagent-driven-development` reviews each task — cheaper, stricter, and harder to game. 

While these numbers won't hold on every harness and for every workload, in our evals, Claude Code and Codex produce similar high-quality results roughly twice as fast and while spending almost 50% fewer tokens.

It also adds three new harnesses (Kimi Code, Pi, and Antigravity), gives the brainstorming visual companion a better security model, and rewrites a number of skills' tool calls to be significantly more vendor-neutral.

### Visible Changes

- **The two per-task reviewer prompts became one.** `spec-reviewer-prompt.md` and `code-quality-reviewer-prompt.md` are gone, replaced by a single `task-reviewer-prompt.md`. If you dispatch the old files directly, switch to the new one.
- **The legacy global worktree directory is gone.** `using-git-worktrees` and `finishing-a-development-branch` no longer use `~/.config/superpowers/worktrees/`. Worktrees now land in the project — an existing `.worktrees/` or `worktrees/` if you have one, otherwise a fresh `.worktrees/` — unless you say otherwise.

### New Harness Support

Superpowers now runs on three more harnesses. Each ships its own bootstrap, a tool-mapping reference, and tests, and each gets its own install section in the README.

- **Kimi Code** — a plugin manifest, install docs, and manifest tests; install from Kimi's marketplace or straight from the repo. (initial manifest by @qer)
- **Pi** — a session-start extension that registers the skills and injects the `using-superpowers` bootstrap. Pi has native skills, so it needs no compatibility shim.
- **Antigravity (`agy`)** — installs the plugin directly and bootstraps from the first message; verified end-to-end against the standard "make a react todo list" acceptance test.

### Subagent-Driven Development

A long run of cost-and-quality experiments on real projects reshaped how the controller reviews each task. The old flow ran two reviewers per task and leaned on the controller's judgment for model choice and severity, and both turned out to be expensive and easy to game. The new flow runs one reviewer per task, hands work off as files instead of pasted text, and takes several judgment calls away from the controller.

- **One reviewer per task, two verdicts.** A single `task-reviewer-prompt.md` reads the task's diff once and returns both a spec-compliance verdict and a quality verdict, so one fix pass clears both. A new "can't verify from the diff" verdict flags requirements that live in untouched code, for the controller to check itself. (#1538, #1543)
- **One broad review at the end.** The run finishes with a single whole-branch review on the most capable model, instead of re-reviewing everything task by task.
- **Plans get a pre-flight read.** Before the first task, the controller checks the plan for internal conflicts — and for anything the plan asks for that a reviewer would flag as a defect — and raises it all at once, rather than stumbling into it mid-run.
- **Diffs and task text move as files.** A pasted diff parks itself permanently in the most expensive context, and a reviewer without one rebuilds it by hand — the single biggest reviewer cost. Two new scripts, `task-brief` and `review-package`, write the task text and the review diff to files for the subagent to read.
- **Every dispatch states its model.** Left to choose, controllers stopped naming a model at all — and an unnamed model quietly inherits the session's most expensive one, so one run put all 26 of its reviewers on the top tier. The templates now require a model, with guidance that reaches for cheaper tiers when the work allows.
- **The controller can't tell a reviewer what to ignore.** Real runs caught controllers coaching reviewers to skip a finding or call it "Minor at most," and the flaw shipped. Suppressing findings and pre-rating severity are now banned outright, and a defect the plan itself mandates gets reported for you to decide on rather than waved through.
- **Reviewers are read-only and skeptical of rationales.** Review no longer touches the working tree or branch — a reviewer running `git checkout` had been orphaning later commits — and an implementer's "I left this unabstracted on purpose" no longer talks a reviewer out of a real finding.
- **Stronger evidence and reporting.** Reviewers back each answer with a file and line, the implementer's report moves to a file and carries red/green evidence when TDD applies, and a progress ledger lets a controller that loses its context resume instead of redoing finished work. (#994)

### Writing Plans

Plans now carry the structure the controller and reviewers used to re-derive on every dispatch.

- **A Global Constraints block** lists the rules that bind every task — version floors, dependency limits, naming and copy, exact values — copied in verbatim, so they actually reach the implementers and reviewers downstream.
- **A per-task Interfaces block** names exactly what each task consumes and produces, so an implementer who sees only its own task still knows its neighbors' contracts.
- **Right-sizing guidance** keeps a task at the size that earns its own test cycle and a reviewer's pass, folding setup, config, and docs into the task that needs them. In testing, a plan written this way needed one round of fixes where the control needed two to four — and the control shipped a real bug.

### Brainstorming Visual Companion

The visual companion is a small web server the agent opens alongside the conversation. It had no authentication at all, so on a shared or remote machine anyone who could reach the port could read your brainstorm — or inject events the agent treats as your input. This release gives it a real security model and makes it survive restarts and dropped connections.

- **A per-session key now guards everything.** The agent's URL carries a one-time key, the browser tucks it into a tab-scoped cookie, and every request and WebSocket connection has to present it. This closes the door to stray local tabs and routable remote hosts alike, including the DNS-rebinding case an origin allowlist can't catch. (Closes #1014)
- **The file server stays in its sandbox.** It refuses symlinks, dotfiles, and any path that climbs out of the content directory, ignores macOS resource-fork files, and sends the usual no-store and deny-framing headers. Files that hold the session key are written owner-only.
- **The companion is offered only when it helps.** The skill raises it the first time a question would read better shown than told, as its own message, and lets a decline stand. Accepting opens your browser to the first screen. (Closes #755)
- **It survives restarts and flaky connections.** Given a project directory, the server keeps the same port and key across restarts, so an open tab simply reconnects. The page reconnects on its own, shows a live status pill, and raises a "paused" overlay while the server is down.
- **Longer idle life, safer shutdown.** The idle timeout went from 30 minutes to 4 hours, and `stop-server.sh` now confirms it owns the right process before signaling, so it never kills an unrelated `node` after a reboot. (#1703)
- **Windows launch hardening** — consolidated shell detection, and Windows now relies on the idle timeout for shutdown, since Node can't track POSIX process ownership across MSYS2.


### Existing Harness Updates

- **Codex** now bootstraps through its own SessionStart hook rather than shared wiring, and the Codex App gained an install section and fuller tool docs (web search, `AGENTS.md`, personal skills). (#1540)
- **OpenCode** got an action-based tool mapping across its plugin, install doc, and README, plus a bootstrap-caching test.
- **Cursor**'s manifest dropped its `agents` and `commands` entries, since those directories no longer exist.

### One Set of Skills, Every Harness

The skills used to speak Claude Code's dialect — "use the Task tool," "put it in CLAUDE.md." This release rewrites that vocabulary in terms of what you're actually doing ("dispatch a subagent," "your instructions file") and adds a per-harness reference that maps each action to the right tool, checked against each runtime. Prose that named "Claude" now says "your agent."

- **A tool reference per harness** at `skills/using-superpowers/references/`, covering Claude Code, Codex, Copilot, Gemini, Pi, and Antigravity.
- **`finishing-a-development-branch` went forge-neutral** — it no longer hardcodes `gh pr create`, so agents push with whatever forge tooling they have. (#1609)
- **One rename:** "Claude Search Optimization" is now "Skill Discovery Optimization," since the technique isn't Claude-specific.

### Writing Skills

Two additions for skill authors.

- **Match the Form to the Failure** — a short table for picking the right kind of guidance. A flat "don't do X" works for discipline slips but backfires when the problem is the *shape* of an output, where a worked example does better. The table, and a tighter scope on the existing rationalization section, steer authors to the form that actually helps.
- **Micro-Test Wording** — a cheap way to check a phrasing before committing to it: sample it a handful of times against a no-guidance control and read every result by hand, treating run-to-run variance as a warning sign.

### Testing

Skill-behavior testing moved out of `tests/` into a new `evals/` submodule built on "drill," which runs real Claude Code, Codex, and Gemini sessions and judges them with an LLM. Several in-tree bash suites retired once a stricter drill scenario covered them; the few with no equivalent stayed. From here on, `tests/` holds plugin-code tests and `evals/` holds skill-behavior tests, and `docs/testing.md` explains the split. New backends reach Antigravity, Pi, and more models, and new shell-lint and pre-commit checks guard the harness. (#1541)

### Bug Fixes

- **systematic-debugging no longer forces every session into extended thinking.** One bullet held the exact keyword Claude Code scans for, quietly tripping the switch on every session that loaded the skill. A hyphen breaks the keyword; the text still reads. (#1283, by @Nick Galatis)
- **The Windows SessionStart hook stopped printing a write error every session** — each `printf` now routes through `cat` to absorb the broken pipe, and the output is otherwise unchanged. (#1612, reported by @silvertakana)
- **Windows foreground mode** tracks the right process and clears its owner PID on MSYS2. (by @nestorluiscamachopaz)
- **The `using-superpowers` bootstrap** no longer lists "debugging" as a skill that doesn't exist. (reported by @mhat)
- **The TDD skill** links the testing anti-patterns reference. (#1532, #1529; link fix #1474 by @Stable Genius)
- **`using-git-worktrees`** fixes its step numbering and drops stale Cursor references. (#1522, and by @fuleinist)
- **The Codex review skill** swaps a private in-joke for plain guidance. (#1531)

### Documentation & Contributor Guidelines

- **A guide to porting Superpowers to a new harness** (`docs/porting-to-a-new-harness.md`) lays out the three pieces every integration needs and the one rule that makes or breaks it: load the bootstrap at session start.
- **Every PR and issue now discloses how it was made** — model, harness, version, and installed plugins, or a note that it was written by hand. We weigh a contribution differently depending on what produced it. PRs also target `dev`, not `main`. The PR template, all three issue templates, and a new platform-support template carry this.

### Contributors

Thanks to @mattvanhorn, @nawfal, @Nick Galatis, @silvertakana, @nestorluiscamachopaz, @qer, @mhat, @Stable Genius, @fuleinist, @dev_Hakaze, @robotsnh, Rahul, and @arittr.

## v5.1.0 (2026-04-30)

### Removals

- **Legacy slash commands removed** — `/brainstorm`, `/execute-plan`, and `/write-plan` are gone. They were deprecated stubs that did nothing but tell the user to invoke the corresponding skill. Invoke `superpowers:brainstorming`, `superpowers:executing-plans`, and `superpowers:writing-plans` directly instead. (#1188)
- **`superpowers:code-reviewer` named agent removed** — the agent was the plugin's only named agent and was used by exactly two skills, while every other reviewer/implementer subagent in the repo dispatches `general-purpose` with a prompt template alongside its skill. The agent's persona and checklist have been merged into `skills/requesting-code-review/code-reviewer.md` as a self-contained Task-dispatch template. Anyone dispatching `Task (superpowers:code-reviewer)` should switch to `Task (general-purpose)` with the prompt template instead. (PR #1299)
- **Integration sections removed from skills** — these were a legacy of the time before agents had native skills systems and didn't help with steering.

### Worktree Skills Rewrite

`using-git-worktrees` and `finishing-a-development-branch` now detect when the agent is already running inside an isolated worktree and prefer the harness's native worktree controls before falling back to `git worktree`. Behavior was TDD-validated and cross-platform-checked across five harnesses. (PRI-974, PR #1121)

- **Environment detection** — both skills check `GIT_DIR != GIT_COMMON` before doing anything; if already in a linked worktree, creation is skipped entirely. A submodule guard prevents false detection.
- **Consent before creating worktrees** — `using-git-worktrees` no longer creates worktrees implicitly; the skill asks the user first. Fixes #991 (subagent-driven-development was auto-creating worktrees without consent).
- **Native tool preference (Step 1a)** — when the harness exposes its own worktree tool (e.g. Codex), the skill defers to it. The user's stated preference is respected when expressed.
- **Provenance-based cleanup** — `finishing-a-development-branch` only cleans up worktrees inside `.worktrees/` (created by superpowers); anything outside is left alone. Fixes #940 (Option 2 was incorrectly cleaning up worktrees), #999 (merge-then-remove ordering), and #238 (`cd` to repo root before `git worktree remove`).
- **Detached HEAD handling** — the finishing menu collapses to two options when there is no branch to merge from.
- **Hardcoded `/Users/jesse` paths** in skill examples replaced with generic placeholders. (#858, PR #1122)

### Contributor Guidelines for AI Agents

Two new sections at the top of `CLAUDE.md` (symlinked to `AGENTS.md`) speak directly to AI agents. An audit of the last 100 closed PRs against this repo showed a 94% rejection rate driven by AI-generated slop: agents that didn't read the PR template, opened duplicates, fabricated problem descriptions, or pushed fork- or domain-specific changes upstream.

- **Pre-submission checklist** — read the PR template, search for existing PRs, verify a real problem exists, confirm the change belongs in core, and show the human partner the complete diff before submitting.
- **What we will not accept** — third-party dependencies, "compliance" rewrites of skill content, project-specific configuration, bulk PRs, speculative fixes, domain-specific skills, fork-specific changes, fabricated content, and bundled unrelated changes.
- **New harness PRs require a session transcript** — most past new-harness integrations copied skill files or wrapped with `npx skills` instead of loading the `using-superpowers` bootstrap at session start. The acceptance test ("Let's make a react todo list" must auto-trigger `brainstorming` in a clean session) and a complete transcript are now required.

### Codex Plugin Mirror Tooling

New `sync-to-codex-plugin` script mirrors superpowers into the OpenAI Codex plugin marketplace as `prime-radiant-inc/openai-codex-plugins`. Path/user-agnostic so any team member can run it. (PR #1165)

- Clones the fork fresh into a temp directory per run, regenerates overlays inline, and opens a PR; auto-detects upstream from the script's own location and preflights `rsync`/`git`/`gh auth`/`python3`.
- `--bootstrap` flag for first-time setup; `EXCLUDES` patterns anchored to source root; `assets/` excluded.
- Mirrors `CODE_OF_CONDUCT.md`; drops the `agents/openai.yaml` overlay.
- Seeds `interface.defaultPrompt` in the mirrored `plugin.json`. (PR #1180 by @arittr)
- Codex plugin files are committed to the source repo so the sync script uses canonical versions; Codex marketplace metadata is preserved.

### OpenCode

- **Bootstrap content cached at module level** — `getBootstrapContent()` was calling `fs.existsSync` + `fs.readFileSync` + frontmatter regex on every agent step (the `experimental.chat.messages.transform` hook fires on every step in OpenCode's agent loop). Now read once, cached for the session lifetime, with a null sentinel for the missing-file case. 15 regression tests cover cache behavior, fs call counts, the injection guard, the missing-file sentinel, and cache reset. (Fixes #1202)
- **Integration tests modernized**.
- **Install caveats clarified** in the README.

### Code Review Consolidation

`requesting-code-review` is now self-contained: the persona, checklist, and dispatch template live in `skills/requesting-code-review/code-reviewer.md` and the skill dispatches `Task (general-purpose)` directly. (PR #1299)

- **Single source of truth** — the persona/checklist that previously lived in both `agents/code-reviewer.md` and the skill's placeholder template (and drifted independently) is now one file.
- **`subagent-driven-development` follows suit** — its `code-quality-reviewer-prompt.md` now dispatches `Task (general-purpose)` instead of the named agent.
- **Behavioral test added** — `tests/claude-code/test-requesting-code-review.sh` plants real bugs (SQL injection, plaintext password handling, credential logging) into a tiny project and asserts the dispatched reviewer flags every planted issue at Critical/Important severity and refuses to approve the diff.

> Note: `tests/claude-code/test-requesting-code-review.sh` and `tests/claude-code/test-document-review-system.sh` (mentioned later in this document) were lifted into drill scenarios on 2026-05-06 and removed from `tests/`. See `evals/scenarios/code-review-catches-planted-bugs.yaml` and `evals/scenarios/spec-reviewer-catches-planted-flaws.yaml`. The references above and below are preserved as dated artifacts of the work this section describes.
- **Codex and Copilot workaround docs trimmed** — the "Named agent dispatch" sections in `references/codex-tools.md` and `references/copilot-tools.md` documented how to flatten a named agent into a generic dispatch. With no named agents shipping, the workaround is unnecessary; both sections were dropped.

### Subagent-Driven Development

- **No more pause every 3 tasks** — the "review after each batch (3 tasks)" cadence in `requesting-code-review` (originally for `executing-plans`) was leaking into `subagent-driven-development`. Replaced with "each task or at natural checkpoints" plus an explicit continuous-execution directive.
- **SDD integration test now runs its assertions** — three independent bugs caused the test to silently bail before printing any verification results: an unresolved `..` segment in the working-dir path, a `set -euo pipefail` interaction with `find | sort | head -1` (SIGPIPE on the producer killed the script), and a missing `--plugin-dir` on the `claude -p` invocation that caused the test to load the installed plugin instead of the working tree. All three fixed; six verification tests now actually run against a real end-to-end SDD run.

### Cursor

- **Windows SessionStart hook** routed through `run-hook.cmd` instead of invoking the extensionless `session-start` script directly. Fixes Windows opening the file in an editor instead of running it. Also removed an accidental UTF-8 BOM from `hooks-cursor.json`.

### Gemini CLI

- **Subagent dispatch mapping** — Gemini's `Task` dispatch now maps to `@agent-name` / `@generalist`, with parallel subagent dispatch documented for independent tasks.

### Skills

- **Terminology cleanups** across skill content.

### Documentation & Install

- **Factory Droid installation instructions** added to README.
- **Quickstart install links** in README. (PR #1293 by @arittr)
- **Codex plugin install guidance** updated. (PR #1288 by @arittr)
- **Codex `wait` mapping corrected** to `wait_agent` in the tools reference.
- **Install order reorganized**; Codex install instructions cleaned up.
- **Removed vestigial `CHANGELOG.md`** in favor of `RELEASE-NOTES.md` as the single source. (PR #1163 by @shaanmajid)
- **Discord invite link** fixed; release announcements link and a detailed Discord description added to the Community section.

### Community

- @shaanmajid — vestigial `CHANGELOG.md` removal (PR #1163)
- @arittr — README quickstart install links (#1293), Codex plugin install guidance (#1288), `sync-to-codex-plugin` `interface.defaultPrompt` seed (#1180)

## v5.0.7 (2026-03-31)

### GitHub Copilot CLI Support

- **SessionStart context injection** — Copilot CLI v1.0.11 added support for `additionalContext` in sessionStart hook output. The session-start hook now detects the `COPILOT_CLI` environment variable and emits the SDK-standard `{ "additionalContext": "..." }` format, giving Copilot CLI users the full superpowers bootstrap at session start. (Original fix by @culinablaz in PR #910)
- **Tool mapping** — added `references/copilot-tools.md` with the full Claude Code to Copilot CLI tool equivalence table
- **Skill and README updates** — added Copilot CLI to the `using-superpowers` skill's platform instructions and README installation section

### OpenCode Fixes

- **Skills path consistency** — the bootstrap text no longer advertises a misleading `configDir/skills/superpowers/` path that didn't match the runtime path. The agent should use the native `skill` tool, not navigate to files by path. Tests now use consistent paths derived from a single source of truth. (#847, #916)
- **Bootstrap as user message** — moved bootstrap injection from `experimental.chat.system.transform` to `experimental.chat.messages.transform`, prepending to the first user message instead of adding a system message. Avoids token bloat from system messages repeated every turn (#750) and fixes compatibility with Qwen and other models that break on multiple system messages (#894).

## v5.0.6 (2026-03-24)

### Inline Self-Review Replaces Subagent Review Loops

The subagent review loop (dispatching a fresh agent to review plans/specs) doubled execution time (~25 min overhead) without measurably improving plan quality. Regression testing across 5 versions with 5 trials each showed identical quality scores regardless of whether the review loop ran.

- **brainstorming** — replaced Spec Review Loop (subagent dispatch + 3-iteration cap) with inline Spec Self-Review checklist: placeholder scan, internal consistency, scope check, ambiguity check
- **writing-plans** — replaced Plan Review Loop (subagent dispatch + 3-iteration cap) with inline Self-Review checklist: spec coverage, placeholder scan, type consistency
- **writing-plans** — added explicit "No Placeholders" section defining plan failures (TBD, vague descriptions, undefined references, "similar to Task N")
- Self-review catches 3-5 real bugs per run in ~30s instead of ~25 min, with comparable defect rates to the subagent approach

### Brainstorm Server

- **Session directory restructured** — the brainstorm server session directory now contains two peer subdirectories: `content/` (HTML files served to the browser) and `state/` (events, server-info, pid, log). Previously, server state and user interaction data were stored alongside served content, making them accessible over HTTP. The `screen_dir` and `state_dir` paths are both included in the server-started JSON. (Reported by 吉田仁)

### Bug Fixes

- **Owner-PID lifecycle fixes** — the brainstorm server's owner-PID monitoring had two bugs causing false shutdowns within 60 seconds: (1) EPERM from cross-user PIDs (Tailscale SSH, etc.) was treated as "process dead", and (2) on WSL the grandparent PID resolves to a short-lived subprocess that exits before the first lifecycle check. Fixed by treating EPERM as "alive" and validating the owner PID at startup — if it's already dead, monitoring is disabled and the server relies on the 30-minute idle timeout. This also removes the Windows/MSYS2-specific carve-out from `start-server.sh` since the server now handles it generically. (#879)
- **writing-skills** — corrected false claim that SKILL.md frontmatter supports "only two fields"; now says "two required fields" and links to the agentskills.io specification for all supported fields (PR #882 by @arittr)

### Codex App Compatibility

- **codex-tools** — added named agent dispatch mapping documenting how to translate Claude Code's named agent types to Codex's `spawn_agent` with worker roles (PR #647 by @arittr)
- **codex-tools** — added environment detection and Codex App finishing sections for worktree-aware skills (by @arittr)
- **Design spec** — added Codex App compatibility design spec (PRI-823) covering read-only environment detection, worktree-safe skill behavior, and sandbox fallback patterns (by @arittr)

## v5.0.5 (2026-03-17)

### Bug Fixes

- **Brainstorm server ESM fix** — renamed `server.js` → `server.cjs` so the brainstorming server starts correctly on Node.js 22+ where the root `package.json` `"type": "module"` caused `require()` to fail. (PR #784 by @sarbojitrana, fixes #774, #780, #783)
- **Brainstorm owner-PID on Windows** — skip PID lifecycle monitoring on Windows/MSYS2 where the PID namespace is invisible to Node.js, preventing the server from self-terminating after 60 seconds. (#770, docs from PR #768 by @lucasyhzlu-debug)
- **stop-server.sh reliability** — verify the server process actually died before reporting success. SIGTERM + 2s wait + SIGKILL fallback. (#723)

### Changed

- **Execution handoff** — restore user choice between subagent-driven and inline execution after plan writing. Subagent-driven is recommended but no longer mandatory.

## v5.0.4 (2026-03-16)

### Review Loop Refinements

Dramatically reduces token usage and speeds up spec and plan reviews by eliminating unnecessary review passes and tightening reviewer focus.

- **Single whole-plan review** — plan reviewer now reviews the complete plan in one pass instead of chunk-by-chunk. Removed all chunk-related concepts (`## Chunk N:` headings, 1000-line chunk limits, per-chunk dispatch).
- **Raised the bar for blocking issues** — both spec and plan reviewer prompts now include a "Calibration" section: only flag issues that would cause real problems during implementation. Minor wording, stylistic preferences, and formatting quibbles should not block approval.
- **Reduced max review iterations** — from 5 to 3 for both spec and plan review loops. If the reviewer is calibrated correctly, 3 rounds is plenty.
- **Streamlined reviewer checklists** — spec reviewer trimmed from 7 categories to 5; plan reviewer from 7 to 4. Removed formatting-focused checks (task syntax, chunk size) in favor of substance (buildability, spec alignment).

### OpenCode

- **One-line plugin install** — OpenCode plugin now auto-registers the skills directory via a `config` hook. No symlinks or `skills.paths` config needed. Install is just adding one line to `opencode.json`. (PR #753)
- **Added `package.json`** so OpenCode can install superpowers as an npm package from git.

### Bug Fixes

- **Verify server actually stopped** — `stop-server.sh` now confirms the process is dead before reporting success. SIGTERM + 2s wait + SIGKILL fallback. Reports failure if the process survives. (PR #751)
- **Generic agent language** — brainstorm companion waiting page now says "the agent" instead of "Claude".

## v5.0.3 (2026-03-15)

### Cursor Support

- **Cursor hooks** — added `hooks/hooks-cursor.json` with Cursor's camelCase format (`sessionStart`, `version: 1`) and updated `.cursor-plugin/plugin.json` to reference it. Fixed platform detection in `session-start` to check `CURSOR_PLUGIN_ROOT` first (Cursor may also set `CLAUDE_PLUGIN_ROOT`). (Based on PR #709)

### Bug Fixes

- **Stop firing SessionStart hook on `--resume`** — the startup hook was re-injecting context on resumed sessions, which already have the context in their conversation history. The hook now fires only on `startup`, `clear`, and `compact`.
- **Bash 5.3+ hook hang** — replaced heredoc (`cat <<EOF`) with `printf` in `hooks/session-start`. Fixes indefinite hang on macOS with Homebrew bash 5.3+ caused by a bash regression with large variable expansion in heredocs. (#572, #571)
- **POSIX-safe hook script** — replaced `${BASH_SOURCE[0]:-$0}` with `$0` in `hooks/session-start`. Fixes "Bad substitution" error on Ubuntu/Debian where `/bin/sh` is dash. (#553)
- **Portable shebangs** — replaced `#!/bin/bash` with `#!/usr/bin/env bash` in all shell scripts. Fixes execution on NixOS, FreeBSD, and macOS with Homebrew bash where `/bin/bash` is outdated or missing. (#700)
- **Brainstorm server on Windows** — auto-detect Windows/Git Bash (`OSTYPE=msys*`, `MSYSTEM`) and switch to foreground mode, fixing silent server failure caused by `nohup`/`disown` process reaping. (#737)
- **Codex docs fix** — replaced deprecated `collab` flag with `multi_agent` in Codex documentation. (PR #749)

## v5.0.2 (2026-03-11)

### Zero-Dependency Brainstorm Server

**Removed all vendored node_modules — server.js is now fully self-contained**

- Replaced Express/Chokidar/WebSocket dependencies with zero-dependency Node.js server using built-in `http`, `fs`, and `crypto` modules
- Removed ~1,200 lines of vendored `node_modules/`, `package.json`, and `package-lock.json`
- Custom WebSocket protocol implementation (RFC 6455 framing, ping/pong, proper close handshake)
- Native `fs.watch()` file watching replaces Chokidar
- Full test suite: HTTP serving, WebSocket protocol, file watching, and integration tests

### Brainstorm Server Reliability

- **Auto-exit after 30 minutes idle** — server shuts down when no clients are connected, preventing orphaned processes
- **Owner process tracking** — server monitors the parent harness PID and exits when the owning session dies
- **Liveness check** — skill verifies server is responsive before reusing an existing instance
- **Encoding fix** — proper `<meta charset="utf-8">` on served HTML pages

### Subagent Context Isolation

- All delegation skills (brainstorming, dispatching-parallel-agents, requesting-code-review, subagent-driven-development, writing-plans) now include context isolation principle
- Subagents receive only the context they need, preventing context window pollution

## v5.0.1 (2026-03-10)

### Agentskills Compliance

**Brainstorm-server moved into skill directory**

- Moved `lib/brainstorm-server/` → `skills/brainstorming/scripts/` per the [agentskills.io](https://agentskills.io) specification
- All `${CLAUDE_PLUGIN_ROOT}/lib/brainstorm-server/` references replaced with relative `scripts/` paths
- Skills are now fully portable across platforms — no platform-specific env vars needed to locate scripts
- `lib/` directory removed (was the last remaining content)

### New Features

**Gemini CLI extension**

- Native Gemini CLI extension support via `gemini-extension.json` and `GEMINI.md` at repo root
- `GEMINI.md` @imports `using-superpowers` skill and tool mapping table at session start
- Gemini CLI tool mapping reference (`skills/using-superpowers/references/gemini-tools.md`) — translates Claude Code tool names (Read, Write, Edit, Bash, etc.) to Gemini CLI equivalents (read_file, write_file, replace, etc.)
- Documents Gemini CLI limitations: no subagent support, skills fall back to `executing-plans`
- Extension root at repo root for cross-platform compatibility (avoids Windows symlink issues)
- Install instructions added to README

### Improvements

**Multi-platform brainstorm server launch**

- Per-platform launch instructions in visual-companion.md: Claude Code (default mode), Codex (auto-foreground via `CODEX_CI`), Gemini CLI (`--foreground` with `is_background`), and fallback for other environments
- Server now writes startup JSON to `$SCREEN_DIR/.server-info` so agents can find the URL and port even when stdout is hidden by background execution

**Brainstorm server dependencies bundled**

- `node_modules` vendored into the repo so the brainstorm server works immediately on fresh plugin installs without requiring `npm` at runtime
- Removed `fsevents` from bundled deps (macOS-only native binary; chokidar falls back gracefully without it)
- Fallback auto-install via `npm install` if `node_modules` is missing

**OpenCode tool mapping fix**

- `TodoWrite` → `todowrite` (was incorrectly mapped to `update_plan`); verified against OpenCode source

### Bug Fixes

**Windows/Linux: single quotes break SessionStart hook** (#577, #529, #644, PR #585)

- Single quotes around `${CLAUDE_PLUGIN_ROOT}` in hooks.json fail on Windows (cmd.exe doesn't recognize single quotes as path delimiters) and on Linux (single quotes prevent variable expansion)
- Fix: replaced single quotes with escaped double quotes — works across macOS bash, Windows cmd.exe, Windows Git Bash, and Linux, with and without spaces in paths
- Verified on Windows 11 (NT 10.0.26200.0) with Claude Code 2.1.72 and Git for Windows

**Brainstorming spec review loop skipped** (#677)

- The spec review loop (dispatch spec-document-reviewer subagent, iterate until approved) existed in the prose "After the Design" section but was missing from the checklist and process flow diagram
- Since agents follow the diagram and checklist more reliably than prose, the spec review step was being skipped entirely
- Added step 7 (spec review loop) to the checklist and corresponding nodes to the dot graph
- Tested with `claude --plugin-dir` and `claude-session-driver`: worker now correctly dispatches the reviewer

**Cursor install command** (PR #676)

- Fixed Cursor install command in README: `/plugin-add` → `/add-plugin` (confirmed via Cursor 2.5 release announcement)

**User review gate in brainstorming** (#565)

- Added explicit user review step between spec completion and writing-plans handoff
- User must approve the spec before implementation planning begins
- Checklist, process flow, and prose updated with the new gate

**Session-start hook emits context only once per platform**

- Hook now detects whether it's running in Claude Code or another platform
- Emits `hookSpecificOutput` for Claude Code, `additional_context` for others — prevents double context injection

**Linting fix in token analysis script**

- `except:` → `except Exception:` in `tests/claude-code/analyze-token-usage.py`

### Maintenance

**Removed dead code**

- Deleted `lib/skills-core.js` and its test (`tests/opencode/test-skills-core.js`) — unused since February 2026
- Removed skills-core existence check from `tests/opencode/test-plugin-loading.sh`

### Community

- @karuturi — Claude Code official marketplace install instructions (PR #610)
- @mvanhorn — session-start hook dual-emit fix, OpenCode tool mapping fix
- @daniel-graham — linting fix for bare except
- PR #585 author — Windows/Linux hooks quoting fix

---

## v5.0.0 (2026-03-09)

### Breaking Changes

**Specs and plans directory restructured**

- Specs (brainstorming output) now save to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
- Plans (writing-plans output) now save to `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`
- User preferences for spec/plan locations override these defaults
- All internal skill references, test files, and example paths updated to match
- Migration: move existing files from `docs/plans/` to new locations if desired

**Subagent-driven development mandatory on capable harnesses**

Writing-plans no longer offers a choice between subagent-driven and executing-plans. On harnesses with subagent support (Claude Code, Codex), subagent-driven-development is required. Executing-plans is reserved for harnesses without subagent capability, and now tells the user that Superpowers works better on a subagent-capable platform.

**Executing-plans no longer batches**

Removed the "execute 3 tasks then stop for review" pattern. Plans now execute continuously, stopping only for blockers.

**Slash commands deprecated**

`/brainstorm`, `/write-plan`, and `/execute-plan` now show deprecation notices pointing users to the corresponding skills. Commands will be removed in the next major release.

### New Features

**Visual brainstorming companion**

Optional browser-based companion for brainstorming sessions. When a topic would benefit from visuals, the brainstorming skill offers to show mockups, diagrams, comparisons, and other content in a browser window alongside terminal conversation.

- `lib/brainstorm-server/` — WebSocket server with browser helper library, session management scripts, and dark/light themed frame template ("Superpowers Brainstorming" with GitHub link)
- `skills/brainstorming/visual-companion.md` — Progressive disclosure guide for server workflow, screen authoring, and feedback collection
- Brainstorming skill adds a visual companion decision point to its process flow: after exploring project context, the skill evaluates whether upcoming questions involve visual content and offers the companion in its own message
- Per-question decision: even after accepting, each question is evaluated for whether browser or terminal is more appropriate
- Integration tests in `tests/brainstorm-server/`

**Document review system**

Automated review loops for spec and plan documents using subagent dispatch:

- `skills/brainstorming/spec-document-reviewer-prompt.md` — Reviewer checks completeness, consistency, architecture, and YAGNI
- `skills/writing-plans/plan-document-reviewer-prompt.md` — Reviewer checks spec alignment, task decomposition, file structure, and file size
- Brainstorming dispatches spec reviewer after writing the design doc
- Writing-plans includes chunk-based plan review loop after each section
- Review loops repeat until approved or escalate after 5 iterations
- End-to-end tests in `tests/claude-code/test-document-review-system.sh`
- Design spec and implementation plan in `docs/superpowers/`

**Architecture guidance across the skill pipeline**

Design-for-isolation and file-size-awareness guidance added to brainstorming, writing-plans, and subagent-driven-development:

- **Brainstorming** — New sections: "Design for isolation and clarity" (clear boundaries, well-defined interfaces, independently testable units) and "Working in existing codebases" (follow existing patterns, targeted improvements only)
- **Writing-plans** — New "File Structure" section: map out files and responsibilities before defining tasks. New "Scope Check" backstop: catch multi-subsystem specs that should have been decomposed during brainstorming
- **SDD implementer** — New "Code Organization" section (follow plan's file structure, report concerns about growing files) and "When You're in Over Your Head" escalation guidance
- **SDD code quality reviewer** — Now checks architecture, unit decomposition, plan conformance, and file growth
- **Spec/plan reviewers** — Architecture and file size added to review criteria
- **Scope assessment** — Brainstorming now assesses whether a project is too large for a single spec. Multi-subsystem requests are flagged early and decomposed into sub-projects, each with its own spec → plan → implementation cycle

**Subagent-driven development improvements**

- **Model selection** — Guidance for choosing model capability by task type: cheap models for mechanical implementation, standard for integration, capable for architecture and review
- **Implementer status protocol** — Subagents now report DONE, DONE_WITH_CONCERNS, BLOCKED, or NEEDS_CONTEXT. Controller handles each status appropriately: re-dispatching with more context, upgrading model capability, breaking tasks apart, or escalating to human

### Improvements

**Instruction priority hierarchy**

Added explicit priority ordering to using-superpowers:

1. User's explicit instructions (CLAUDE.md, AGENTS.md, direct requests) — highest priority
2. Superpowers skills — override default system behavior
3. Default system prompt — lowest priority

If CLAUDE.md or AGENTS.md says "don't use TDD" and a skill says "always use TDD," the user's instructions win.

**SUBAGENT-STOP gate**

Added `<SUBAGENT-STOP>` block to using-superpowers. Subagents dispatched for specific tasks now skip the skill instead of activating the 1% rule and invoking full skill workflows.

**Multi-platform improvements**

- Codex tool mapping moved to progressive disclosure reference file (`references/codex-tools.md`)
- Platform Adaptation pointer added so non-Claude-Code platforms can find tool equivalents
- Plan headers now address "agentic workers" instead of "Claude" specifically
- Collab feature requirement documented in `docs/README.codex.md`

**Writing-plans template updates**

- Plan steps now use checkbox syntax (`- [ ] **Step N:**`) for progress tracking
- Plan header references both subagent-driven-development and executing-plans with platform-aware routing

---

## v4.3.1 (2026-02-21)

### Added

**Cursor support**

Superpowers now works with Cursor's plugin system. Includes a `.cursor-plugin/plugin.json` manifest and Cursor-specific installation instructions in the README. The SessionStart hook output now includes an `additional_context` field alongside the existing `hookSpecificOutput.additionalContext` for Cursor hook compatibility.

### Fixed

**Windows: Restored polyglot wrapper for reliable hook execution (#518, #504, #491, #487, #466, #440)**

Claude Code's `.sh` auto-detection on Windows was prepending `bash` to the hook command, breaking execution. The fix:

- Renamed `session-start.sh` to `session-start` (extensionless) so auto-detection doesn't interfere
- Restored `run-hook.cmd` polyglot wrapper with multi-location bash discovery (standard Git for Windows paths, then PATH fallback)
- Exits silently if no bash is found rather than erroring
- On Unix, the wrapper runs the script directly via `exec bash`
- Uses POSIX-safe `dirname "$0"` path resolution (works on dash/sh, not just bash)

This fixes SessionStart failures on Windows with spaces in paths, missing WSL, `set -euo pipefail` fragility on MSYS, and backslash mangling.

## v4.3.0 (2026-02-12)

This fix should dramatically improve superpowers skills compliance and should reduce the chances of Claude entering its native plan mode unintentionally.

### Changed

**Brainstorming skill now enforces its workflow instead of describing it**

Models were skipping the design phase and jumping straight to implementation skills like frontend-design, or collapsing the entire brainstorming process into a single text block. The skill now uses hard gates, a mandatory checklist, and a graphviz process flow to enforce compliance:

- `<HARD-GATE>`: no implementation skills, code, or scaffolding until design is presented and user approves
- Explicit checklist (6 items) that must be created as tasks and completed in order
- Graphviz process flow with `writing-plans` as the only valid terminal state
- Anti-pattern callout for "this is too simple to need a design" — the exact rationalization models use to skip the process
- Design section sizing based on section complexity, not project complexity

**Using-superpowers workflow graph intercepts EnterPlanMode**

Added an `EnterPlanMode` intercept to the skill flow graph. When the model is about to enter Claude's native plan mode, it checks whether brainstorming has happened and routes through the brainstorming skill instead. Plan mode is never entered.

### Fixed

**SessionStart hook now runs synchronously**

Changed `async: true` to `async: false` in hooks.json. When async, the hook could fail to complete before the model's first turn, meaning using-superpowers instructions weren't in context for the first message.

## v4.2.0 (2026-02-05)

### Breaking Changes

**Codex: Replaced bootstrap CLI with native skill discovery**

The `superpowers-codex` bootstrap CLI, Windows `.cmd` wrapper, and related bootstrap content file have been removed. Codex now uses native skill discovery via `~/.agents/skills/superpowers/` symlink, so the old `use_skill`/`find_skills` CLI tools are no longer needed.

Installation is now just clone + symlink (documented in INSTALL.md). No Node.js dependency required. The old `~/.codex/skills/` path is deprecated.

### Fixes

**Windows: Fixed Claude Code 2.1.x hook execution (#331)**

Claude Code 2.1.x changed how hooks execute on Windows: it now auto-detects `.sh` files in commands and prepends `bash`. This broke the polyglot wrapper pattern because `bash "run-hook.cmd" session-start.sh` tries to execute the `.cmd` file as a bash script.

Fix: hooks.json now calls session-start.sh directly. Claude Code 2.1.x handles the bash invocation automatically. Also added .gitattributes to enforce LF line endings for shell scripts (fixes CRLF issues on Windows checkout).

**Windows: SessionStart hook runs async to prevent terminal freeze (#404, #413, #414, #419)**

The synchronous SessionStart hook blocked the TUI from entering raw mode on Windows, freezing all keyboard input. Running the hook async prevents the freeze while still injecting superpowers context.

**Windows: Fixed O(n^2) `escape_for_json` performance**

The character-by-character loop using `${input:$i:1}` was O(n^2) in bash due to substring copy overhead. On Windows Git Bash this took 60+ seconds. Replaced with bash parameter substitution (`${s//old/new}`) which runs each pattern as a single C-level pass — 7x faster on macOS, dramatically faster on Windows.

**Codex: Fixed Windows/PowerShell invocation (#285, #243)**

- Windows doesn't respect shebangs, so directly invoking the extensionless `superpowers-codex` script triggered an "Open with" dialog. All invocations now prefixed with `node`.
- Fixed `~/` path expansion on Windows — PowerShell doesn't expand `~` when passed as an argument to `node`. Changed to `$HOME` which expands correctly in both bash and PowerShell.

**Codex: Fixed path resolution in installer**

Used `fileURLToPath()` instead of manual URL pathname parsing to correctly handle paths with spaces and special characters on all platforms.

**Codex: Fixed stale skills path in writing-skills**

Updated `~/.codex/skills/` reference (deprecated) to `~/.agents/skills/` for native discovery.

### Improvements

**Worktree isolation now required before implementation**

Added `using-git-worktrees` as a required skill for both `subagent-driven-development` and `executing-plans`. Implementation workflows now explicitly require setting up an isolated worktree before starting work, preventing accidental work directly on main.

**Main branch protection softened to require explicit consent**

Instead of prohibiting main branch work entirely, the skills now allow it with explicit user consent. More flexible while still ensuring users are aware of the implications.

**Simplified installation verification**

Removed `/help` command check and specific slash command list from verification steps. Skills are primarily invoked by describing what you want to do, not by running specific commands.

**Codex: Clarified subagent tool mapping in bootstrap**

Improved documentation of how Codex tools map to Claude Code equivalents for subagent workflows.

### Tests

- Added worktree requirement test for subagent-driven-development
- Added main branch red flag warning test
- Fixed case sensitivity in skill recognition test assertions

---

## v4.1.1 (2026-01-23)

### Fixes

**OpenCode: Standardized on `plugins/` directory per official docs (#343)**

OpenCode's official documentation uses `~/.config/opencode/plugins/` (plural). Our docs previously used `plugin/` (singular). While OpenCode accepts both forms, we've standardized on the official convention to avoid confusion.

Changes:
- Renamed `.opencode/plugin/` to `.opencode/plugins/` in repo structure
- Updated all installation docs (INSTALL.md, README.opencode.md) across all platforms
- Updated test scripts to match

**OpenCode: Fixed symlink instructions (#339, #342)**

- Added explicit `rm` before `ln -s` (fixes "file already exists" errors on reinstall)
- Added missing skills symlink step that was absent from INSTALL.md
- Updated from deprecated `use_skill`/`find_skills` to native `skill` tool references

---

## v4.1.0 (2026-01-23)

### Breaking Changes

**OpenCode: Switched to native skills system**

Superpowers for OpenCode now uses OpenCode's native `skill` tool instead of custom `use_skill`/`find_skills` tools. This is a cleaner integration that works with OpenCode's built-in skill discovery.

**Migration required:** Skills must be symlinked to `~/.config/opencode/skills/superpowers/` (see updated installation docs).

### Fixes

**OpenCode: Fixed agent reset on session start (#226)**

The previous bootstrap injection method using `session.prompt({ noReply: true })` caused OpenCode to reset the selected agent to "build" on first message. Now uses `experimental.chat.system.transform` hook which modifies the system prompt directly without side effects.

**OpenCode: Fixed Windows installation (#232)**

- Removed dependency on `skills-core.js` (eliminates broken relative imports when file is copied instead of symlinked)
- Added comprehensive Windows installation docs for cmd.exe, PowerShell, and Git Bash
- Documented proper symlink vs junction usage for each platform

**Claude Code: Fixed Windows hook execution for Claude Code 2.1.x**

Claude Code 2.1.x changed how hooks execute on Windows: it now auto-detects `.sh` files in commands and prepends `bash `. This broke the polyglot wrapper pattern because `bash "run-hook.cmd" session-start.sh` tries to execute the .cmd file as a bash script.

Fix: hooks.json now calls session-start.sh directly. Claude Code 2.1.x handles the bash invocation automatically. Also added .gitattributes to enforce LF line endings for shell scripts (fixes CRLF issues on Windows checkout).

---

## v4.0.3 (2025-12-26)

### Improvements

**Strengthened using-superpowers skill for explicit skill requests**

Addressed a failure mode where Claude would skip invoking a skill even when the user explicitly requested it by name (e.g., "subagent-driven-development, please"). Claude would think "I know what that means" and start working directly instead of loading the skill.

Changes:
- Updated "The Rule" to say "Invoke relevant or requested skills" instead of "Check for skills" - emphasizing active invocation over passive checking
- Added "BEFORE any response or action" - the original wording only mentioned "response" but Claude would sometimes take action without responding first
- Added reassurance that invoking a wrong skill is okay - reduces hesitation
- Added new red flag: "I know what that means" → Knowing the concept ≠ using the skill

**Added explicit skill request tests**

New test suite in `tests/explicit-skill-requests/` that verifies Claude correctly invokes skills when users request them by name. Includes single-turn and multi-turn test scenarios.

## v4.0.2 (2025-12-23)

### Fixes

**Slash commands now user-only**

Added `disable-model-invocation: true` to all three slash commands (`/brainstorm`, `/execute-plan`, `/write-plan`). Claude can no longer invoke these commands via the Skill tool—they're restricted to manual user invocation only.

The underlying skills (`superpowers:brainstorming`, `superpowers:executing-plans`, `superpowers:writing-plans`) remain available for Claude to invoke autonomously. This change prevents confusion when Claude would invoke a command that just redirects to a skill anyway.

## v4.0.1 (2025-12-23)

### Fixes

**Clarified how to access skills in Claude Code**

Fixed a confusing pattern where Claude would invoke a skill via the Skill tool, then try to Read the skill file separately. The `using-superpowers` skill now explicitly states that the Skill tool loads skill content directly—no need to read files.

- Added "How to Access Skills" section to `using-superpowers`
- Changed "read the skill" → "invoke the skill" in instructions
- Updated slash commands to use fully qualified skill names (e.g., `superpowers:brainstorming`)

**Added GitHub thread reply guidance to receiving-code-review** (h/t @ralphbean)

Added a note about replying to inline review comments in the original thread rather than as top-level PR comments.

**Added automation-over-documentation guidance to writing-skills** (h/t @EthanJStark)

Added guidance that mechanical constraints should be automated, not documented—save skills for judgment calls.

## v4.0.0 (2025-12-17)

### New Features

**Two-stage code review in subagent-driven-development**

Subagent workflows now use two separate review stages after each task:

1. **Spec compliance review** - Skeptical reviewer verifies implementation matches spec exactly. Catches missing requirements AND over-building. Won't trust implementer's report—reads actual code.

2. **Code quality review** - Only runs after spec compliance passes. Reviews for clean code, test coverage, maintainability.

This catches the common failure mode where code is well-written but doesn't match what was requested. Reviews are loops, not one-shot: if reviewer finds issues, implementer fixes them, then reviewer checks again.

Other subagent workflow improvements:
- Controller provides full task text to workers (not file references)
- Workers can ask clarifying questions before AND during work
- Self-review checklist before reporting completion
- Plan read once at start, extracted to TodoWrite

New prompt templates in `skills/subagent-driven-development/`:
- `implementer-prompt.md` - Includes self-review checklist, encourages questions
- `spec-reviewer-prompt.md` - Skeptical verification against requirements
- `code-quality-reviewer-prompt.md` - Standard code review

**Debugging techniques consolidated with tools**

`systematic-debugging` now bundles supporting techniques and tools:
- `root-cause-tracing.md` - Trace bugs backward through call stack
- `defense-in-depth.md` - Add validation at multiple layers
- `condition-based-waiting.md` - Replace arbitrary timeouts with condition polling
- `find-polluter.sh` - Bisection script to find which test creates pollution
- `condition-based-waiting-example.ts` - Complete implementation from real debugging session

**Testing anti-patterns reference**

`test-driven-development` now includes `testing-anti-patterns.md` covering:
- Testing mock behavior instead of real behavior
- Adding test-only methods to production classes
- Mocking without understanding dependencies
- Incomplete mocks that hide structural assumptions

**Skill test infrastructure**

Three new test frameworks for validating skill behavior:

`tests/skill-triggering/` - Validates skills trigger from naive prompts without explicit naming. Tests 6 skills to ensure descriptions alone are sufficient.

`tests/claude-code/` - Integration tests using `claude -p` for headless testing. Verifies skill usage via session transcript (JSONL) analysis. Includes `analyze-token-usage.py` for cost tracking.

`tests/subagent-driven-dev/` - End-to-end workflow validation with two complete test projects:
- `go-fractals/` - CLI tool with Sierpinski/Mandelbrot (10 tasks)
- `svelte-todo/` - CRUD app with localStorage and Playwright (12 tasks)

### Major Changes

**DOT flowcharts as executable specifications**

Rewrote key skills using DOT/GraphViz flowcharts as the authoritative process definition. Prose becomes supporting content.

**The Description Trap** (documented in `writing-skills`): Discovered that skill descriptions override flowchart content when descriptions contain workflow summaries. Claude follows the short description instead of reading the detailed flowchart. Fix: descriptions must be trigger-only ("Use when X") with no process details.

**Skill priority in using-superpowers**

When multiple skills apply, process skills (brainstorming, debugging) now explicitly come before implementation skills. "Build X" triggers brainstorming first, then domain skills.

**brainstorming trigger strengthened**

Description changed to imperative: "You MUST use this before any creative work—creating features, building components, adding functionality, or modifying behavior."

### Breaking Changes

**Skill consolidation** - Six standalone skills merged:
- `root-cause-tracing`, `defense-in-depth`, `condition-based-waiting` → bundled in `systematic-debugging/`
- `testing-skills-with-subagents` → bundled in `writing-skills/`
- `testing-anti-patterns` → bundled in `test-driven-development/`
- `sharing-skills` removed (obsolete)

### Other Improvements

- **render-graphs.js** - Tool to extract DOT diagrams from skills and render to SVG
- **Rationalizations table** in using-superpowers - Scannable format including new entries: "I need more context first", "Let me explore first", "This feels productive"
- **docs/testing.md** - Guide to testing skills with Claude Code integration tests

---

## v3.6.2 (2025-12-03)

### Fixed

- **Linux Compatibility**: Fixed polyglot hook wrapper (`run-hook.cmd`) to use POSIX-compliant syntax
  - Replaced bash-specific `${BASH_SOURCE[0]:-$0}` with standard `$0` on line 16
  - Resolves "Bad substitution" error on Ubuntu/Debian systems where `/bin/sh` is dash
  - Fixes #141

---

## v3.5.1 (2025-11-24)

### Changed

- **OpenCode Bootstrap Refactor**: Switched from `chat.message` hook to `session.created` event for bootstrap injection
  - Bootstrap now injects at session creation via `session.prompt()` with `noReply: true`
  - Explicitly tells the model that using-superpowers is already loaded to prevent redundant skill loading
  - Consolidated bootstrap content generation into shared `getBootstrapContent()` helper
  - Cleaner single-implementation approach (removed fallback pattern)

---

## v3.5.0 (2025-11-23)

### Added

- **OpenCode Support**: Native JavaScript plugin for OpenCode.ai
  - Custom tools: `use_skill` and `find_skills`
  - Message insertion pattern for skill persistence across context compaction
  - Automatic context injection via chat.message hook
  - Auto re-injection on session.compacted events
  - Three-tier skill priority: project > personal > superpowers
  - Project-local skills support (`.opencode/skills/`)
  - Shared core module (`lib/skills-core.js`) for code reuse with Codex
  - Automated test suite with proper isolation (`tests/opencode/`)
  - Platform-specific documentation (`docs/README.opencode.md`, `docs/README.codex.md`)

### Changed

- **Refactored Codex Implementation**: Now uses shared `lib/skills-core.js` ES module
  - Eliminates code duplication between Codex and OpenCode
  - Single source of truth for skill discovery and parsing
  - Codex successfully loads ES modules via Node.js interop

- **Improved Documentation**: Rewrote README to explain problem/solution clearly
  - Removed duplicate sections and conflicting information
  - Added complete workflow description (brainstorm → plan → execute → finish)
  - Simplified platform installation instructions
  - Emphasized skill-checking protocol over automatic activation claims

---

## v3.4.1 (2025-10-31)

### Improvements

- Optimized superpowers bootstrap to eliminate redundant skill execution. The `using-superpowers` skill content is now provided directly in session context, with clear guidance to use the Skill tool only for other skills. This reduces overhead and prevents the confusing loop where agents would execute `using-superpowers` manually despite already having the content from session start.

## v3.4.0 (2025-10-30)

### Improvements

- Simplified `brainstorming` skill to return to original conversational vision. Removed heavyweight 6-phase process with formal checklists in favor of natural dialogue: ask questions one at a time, then present design in 200-300 word sections with validation. Keeps documentation and implementation handoff features.

## v3.3.1 (2025-10-28)

### Improvements

- Updated `brainstorming` skill to require autonomous recon before questioning, encourage recommendation-driven decisions, and prevent agents from delegating prioritization back to humans.
- Applied writing clarity improvements to `brainstorming` skill following Strunk's "Elements of Style" principles (omitted needless words, converted negative to positive form, improved parallel construction).

### Bug Fixes

- Clarified `writing-skills` guidance so it points to the correct agent-specific personal skill directories (`~/.claude/skills` for Claude Code, `~/.codex/skills` for Codex).

## v3.3.0 (2025-10-28)

### New Features

**Experimental Codex Support**
- Added unified `superpowers-codex` script with bootstrap/use-skill/find-skills commands
- Cross-platform Node.js implementation (works on Windows, macOS, Linux)
- Namespaced skills: `superpowers:skill-name` for superpowers skills, `skill-name` for personal
- Personal skills override superpowers skills when names match
- Clean skill display: shows name/description without raw frontmatter
- Helpful context: shows supporting files directory for each skill
- Tool mapping for Codex: TodoWrite→update_plan, subagents→manual fallback, etc.
- Bootstrap integration with minimal AGENTS.md for automatic startup
- Complete installation guide and bootstrap instructions specific to Codex

**Key differences from Claude Code integration:**
- Single unified script instead of separate tools
- Tool substitution system for Codex-specific equivalents
- Simplified subagent handling (manual work instead of delegation)
- Updated terminology: "Superpowers skills" instead of "Core skills"

### Files Added
- `.codex/INSTALL.md` - Installation guide for Codex users
- `.codex/superpowers-bootstrap.md` - Bootstrap instructions with Codex adaptations
- `.codex/superpowers-codex` - Unified Node.js executable with all functionality

**Note:** Codex support is experimental. The integration provides core superpowers functionality but may require refinement based on user feedback.

## v3.2.3 (2025-10-23)

### Improvements

**Updated using-superpowers skill to use Skill tool instead of Read tool**
- Changed skill invocation instructions from Read tool to Skill tool
- Updated description: "using Read tool" → "using Skill tool"
- Updated step 3: "Use the Read tool" → "Use the Skill tool to read and run"
- Updated rationalization list: "Read the current version" → "Run the current version"

The Skill tool is the proper mechanism for invoking skills in Claude Code. This update corrects the bootstrap instructions to guide agents toward the correct tool.

### Files Changed
- Updated: `skills/using-superpowers/SKILL.md` - Changed tool references from Read to Skill

## v3.2.2 (2025-10-21)

### Improvements

**Strengthened using-superpowers skill against agent rationalization**
- Added EXTREMELY-IMPORTANT block with absolute language about mandatory skill checking
  - "If even 1% chance a skill applies, you MUST read it"
  - "You do not have a choice. You cannot rationalize your way out."
- Added MANDATORY FIRST RESPONSE PROTOCOL checklist
  - 5-step process agents must complete before any response
  - Explicit "responding without this = failure" consequence
- Added Common Rationalizations section with 8 specific evasion patterns
  - "This is just a simple question" → WRONG
  - "I can check files quickly" → WRONG
  - "Let me gather information first" → WRONG
  - Plus 5 more common patterns observed in agent behavior

These changes address observed agent behavior where they rationalize around skill usage despite clear instructions. The forceful language and pre-emptive counter-arguments aim to make non-compliance harder.

### Files Changed
- Updated: `skills/using-superpowers/SKILL.md` - Added three layers of enforcement to prevent skill-skipping rationalization

## v3.2.1 (2025-10-20)

### New Features

**Code reviewer agent now included in plugin**
- Added `superpowers:code-reviewer` agent to plugin's `agents/` directory
- Agent provides systematic code review against plans and coding standards
- Previously required users to have personal agent configuration
- All skill references updated to use namespaced `superpowers:code-reviewer`
- Fixes #55

### Files Changed
- New: `agents/code-reviewer.md` - Agent definition with review checklist and output format
- Updated: `skills/requesting-code-review/SKILL.md` - References to `superpowers:code-reviewer`
- Updated: `skills/subagent-driven-development/SKILL.md` - References to `superpowers:code-reviewer`

## v3.2.0 (2025-10-18)

### New Features

**Design documentation in brainstorming workflow**
- Added Phase 4: Design Documentation to brainstorming skill
- Design documents now written to `docs/plans/YYYY-MM-DD-<topic>-design.md` before implementation
- Restores functionality from original brainstorming command that was lost during skill conversion
- Documents written before worktree setup and implementation planning
- Tested with subagent to verify compliance under time pressure

### Breaking Changes

**Skill reference namespace standardization**
- All internal skill references now use `superpowers:` namespace prefix
- Updated format: `superpowers:test-driven-development` (previously just `test-driven-development`)
- Affects all REQUIRED SUB-SKILL, RECOMMENDED SUB-SKILL, and REQUIRED BACKGROUND references
- Aligns with how skills are invoked using the Skill tool
- Files updated: brainstorming, executing-plans, subagent-driven-development, systematic-debugging, testing-skills-with-subagents, writing-plans, writing-skills

### Improvements

**Design vs implementation plan naming**
- Design documents use `-design.md` suffix to prevent filename collisions
- Implementation plans continue using existing `YYYY-MM-DD-<feature-name>.md` format
- Both stored in `docs/plans/` directory with clear naming distinction

## v3.1.1 (2025-10-17)

### Bug Fixes

- **Fixed command syntax in README** (#44) - Updated all command references to use correct namespaced syntax (`/superpowers:brainstorm` instead of `/brainstorm`). Plugin-provided commands are automatically namespaced by Claude Code to avoid conflicts between plugins.

## v3.1.0 (2025-10-17)

### Breaking Changes

**Skill names standardized to lowercase**
- All skill frontmatter `name:` fields now use lowercase kebab-case matching directory names
- Examples: `brainstorming`, `test-driven-development`, `using-git-worktrees`
- All skill announcements and cross-references updated to lowercase format
- This ensures consistent naming across directory names, frontmatter, and documentation

### New Features

**Enhanced brainstorming skill**
- Added Quick Reference table showing phases, activities, and tool usage
- Added copyable workflow checklist for tracking progress
- Added decision flowchart for when to revisit earlier phases
- Added comprehensive AskUserQuestion tool guidance with concrete examples
- Added "Question Patterns" section explaining when to use structured vs open-ended questions
- Restructured Key Principles as scannable table

**Anthropic best practices integration**
- Added `skills/writing-skills/anthropic-best-practices.md` - Official Anthropic skill authoring guide
- Referenced in writing-skills SKILL.md for comprehensive guidance
- Provides patterns for progressive disclosure, workflows, and evaluation

### Improvements

**Skill cross-reference clarity**
- All skill references now use explicit requirement markers:
  - `**REQUIRED BACKGROUND:**` - Prerequisites you must understand
  - `**REQUIRED SUB-SKILL:**` - Skills that must be used in workflow
  - `**Complementary skills:**` - Optional but helpful related skills
- Removed old path format (`skills/collaboration/X` → just `X`)
- Updated Integration sections with categorized relationships (Required vs Complementary)
- Updated cross-reference documentation with best practices

**Alignment with Anthropic best practices**
- Fixed description grammar and voice (fully third-person)
- Added Quick Reference tables for scanning
- Added workflow checklists Claude can copy and track
- Appropriate use of flowcharts for non-obvious decision points
- Improved scannable table formats
- All skills well under 500-line recommendation

### Bug Fixes

- **Re-added missing command redirects** - Restored `commands/brainstorm.md` and `commands/write-plan.md` that were accidentally removed in v3.0 migration
- Fixed `defense-in-depth` name mismatch (was `Defense-in-Depth-Validation`)
- Fixed `receiving-code-review` name mismatch (was `Code-Review-Reception`)
- Fixed `commands/brainstorm.md` reference to correct skill name
- Removed references to non-existent related skills

### Documentation

**writing-skills improvements**
- Updated cross-referencing guidance with explicit requirement markers
- Added reference to Anthropic's official best practices
- Improved examples showing proper skill reference format

## v3.0.1 (2025-10-16)

### Changes

We now use Anthropic's first-party skills system!

## v2.0.2 (2025-10-12)

### Bug Fixes

- **Fixed false warning when local skills repo is ahead of upstream** - The initialization script was incorrectly warning "New skills available from upstream" when the local repository had commits ahead of upstream. The logic now correctly distinguishes between three git states: local behind (should update), local ahead (no warning), and diverged (should warn).

## v2.0.1 (2025-10-12)

### Bug Fixes

- **Fixed session-start hook execution in plugin context** (#8, PR #9) - The hook was failing silently with "Plugin hook error" preventing skills context from loading. Fixed by:
  - Using `${BASH_SOURCE[0]:-$0}` fallback when BASH_SOURCE is unbound in Claude Code's execution context
  - Adding `|| true` to handle empty grep results gracefully when filtering status flags

---

# Superpowers v2.0.0 Release Notes

## Overview

Superpowers v2.0 makes skills more accessible, maintainable, and community-driven through a major architectural shift.

The headline change is **skills repository separation**: all skills, scripts, and documentation have moved from the plugin into a dedicated repository ([obra/superpowers-skills](https://github.com/obra/superpowers-skills)). This transforms superpowers from a monolithic plugin into a lightweight shim that manages a local clone of the skills repository. Skills auto-update on session start. Users fork and contribute improvements via standard git workflows. The skills library versions independently from the plugin.

Beyond infrastructure, this release adds nine new skills focused on problem-solving, research, and architecture. We rewrote the core **using-skills** documentation with imperative tone and clearer structure, making it easier for Claude to understand when and how to use skills. **find-skills** now outputs paths you can paste directly into the Read tool, eliminating friction in the skills discovery workflow.

Users experience seamless operation: the plugin handles cloning, forking, and updating automatically. Contributors find the new architecture makes improving and sharing skills trivial. This release lays the foundation for skills to evolve rapidly as a community resource.

## Breaking Changes

### Skills Repository Separation

**The biggest change:** Skills no longer live in the plugin. They've been moved to a separate repository at [obra/superpowers-skills](https://github.com/obra/superpowers-skills).

**What this means for you:**

- **First install:** Plugin automatically clones skills to `~/.config/superpowers/skills/`
- **Forking:** During setup, you'll be offered the option to fork the skills repo (if `gh` is installed)
- **Updates:** Skills auto-update on session start (fast-forward when possible)
- **Contributing:** Work on branches, commit locally, submit PRs to upstream
- **No more shadowing:** Old two-tier system (personal/core) replaced with single-repo branch workflow

**Migration:**

If you have an existing installation:
1. Your old `~/.config/superpowers/.git` will be backed up to `~/.config/superpowers/.git.bak`
2. Old skills will be backed up to `~/.config/superpowers/skills.bak`
3. Fresh clone of obra/superpowers-skills will be created at `~/.config/superpowers/skills/`

### Removed Features

- **Personal superpowers overlay system** - Replaced with git branch workflow
- **setup-personal-superpowers hook** - Replaced by initialize-skills.sh

## New Features

### Skills Repository Infrastructure

**Automatic Clone & Setup** (`lib/initialize-skills.sh`)
- Clones obra/superpowers-skills on first run
- Offers fork creation if GitHub CLI is installed
- Sets up upstream/origin remotes correctly
- Handles migration from old installation

**Auto-Update**
- Fetches from tracking remote on every session start
- Auto-merges with fast-forward when possible
- Notifies when manual sync needed (branch diverged)
- Uses pulling-updates-from-skills-repository skill for manual sync

### New Skills

**Problem-Solving Skills** (`skills/problem-solving/`)
- **collision-zone-thinking** - Force unrelated concepts together for emergent insights
- **inversion-exercise** - Flip assumptions to reveal hidden constraints
- **meta-pattern-recognition** - Spot universal principles across domains
- **scale-game** - Test at extremes to expose fundamental truths
- **simplification-cascades** - Find insights that eliminate multiple components
- **when-stuck** - Dispatch to right problem-solving technique

**Research Skills** (`skills/research/`)
- **tracing-knowledge-lineages** - Understand how ideas evolved over time

**Architecture Skills** (`skills/architecture/`)
- **preserving-productive-tensions** - Keep multiple valid approaches instead of forcing premature resolution

### Skills Improvements

**using-skills (formerly getting-started)**
- Renamed from getting-started to using-skills
- Complete rewrite with imperative tone (v4.0.0)
- Front-loaded critical rules
- Added "Why" explanations for all workflows
- Always includes /SKILL.md suffix in references
- Clearer distinction between rigid rules and flexible patterns

**writing-skills**
- Cross-referencing guidance moved from using-skills
- Added token efficiency section (word count targets)
- Improved CSO (Claude Search Optimization) guidance

**sharing-skills**
- Updated for new branch-and-PR workflow (v2.0.0)
- Removed personal/core split references

**pulling-updates-from-skills-repository** (new)
- Complete workflow for syncing with upstream
- Replaces old "updating-skills" skill

### Tools Improvements

**find-skills**
- Now outputs full paths with /SKILL.md suffix
- Makes paths directly usable with Read tool
- Updated help text

**skill-run**
- Moved from scripts/ to skills/using-skills/
- Improved documentation

### Plugin Infrastructure

**Session Start Hook**
- Now loads from skills repository location
- Shows full skills list at session start
- Prints skills location info
- Shows update status (updated successfully / behind upstream)
- Moved "skills behind" warning to end of output

**Environment Variables**
- `SUPERPOWERS_SKILLS_ROOT` set to `~/.config/superpowers/skills`
- Used consistently throughout all paths

## Bug Fixes

- Fixed duplicate upstream remote addition when forking
- Fixed find-skills double "skills/" prefix in output
- Removed obsolete setup-personal-superpowers call from session-start
- Fixed path references throughout hooks and commands

## Documentation

### README
- Updated for new skills repository architecture
- Prominent link to superpowers-skills repo
- Updated auto-update description
- Fixed skill names and references
- Updated Meta skills list

### Testing Documentation
- Added comprehensive testing checklist (`docs/TESTING-CHECKLIST.md`)
- Created local marketplace config for testing
- Documented manual testing scenarios

## Technical Details

### File Changes

**Added:**
- `lib/initialize-skills.sh` - Skills repo initialization and auto-update
- `docs/TESTING-CHECKLIST.md` - Manual testing scenarios
- `.claude-plugin/marketplace.json` - Local testing config

**Removed:**
- `skills/` directory (82 files) - Now in obra/superpowers-skills
- `scripts/` directory - Now in obra/superpowers-skills/skills/using-skills/
- `hooks/setup-personal-superpowers.sh` - Obsolete

**Modified:**
- `hooks/session-start.sh` - Use skills from ~/.config/superpowers/skills
- `commands/brainstorm.md` - Updated paths to SUPERPOWERS_SKILLS_ROOT
- `commands/write-plan.md` - Updated paths to SUPERPOWERS_SKILLS_ROOT
- `commands/execute-plan.md` - Updated paths to SUPERPOWERS_SKILLS_ROOT
- `README.md` - Complete rewrite for new architecture

### Commit History

This release includes:
- 20+ commits for skills repository separation
- PR #1: Amplifier-inspired problem-solving and research skills
- PR #2: Personal superpowers overlay system (later replaced)
- Multiple skill refinements and documentation improvements

## Upgrade Instructions

### Fresh Install

```bash
# In Claude Code
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
```

The plugin handles everything automatically.

### Upgrading from v1.x

1. **Backup your personal skills** (if you have any):
   ```bash
   cp -r ~/.config/superpowers/skills ~/superpowers-skills-backup
   ```

2. **Update the plugin:**
   ```bash
   /plugin update superpowers
   ```

3. **On next session start:**
   - Old installation will be backed up automatically
   - Fresh skills repo will be cloned
   - If you have GitHub CLI, you'll be offered the option to fork

4. **Migrate personal skills** (if you had any):
   - Create a branch in your local skills repo
   - Copy your personal skills from backup
   - Commit and push to your fork
   - Consider contributing back via PR

## What's Next

### For Users

- Explore the new problem-solving skills
- Try the branch-based workflow for skill improvements
- Contribute skills back to the community

### For Contributors

- Skills repository is now at https://github.com/obra/superpowers-skills
- Fork → Branch → PR workflow
- See skills/meta/writing-skills/SKILL.md for TDD approach to documentation

## Known Issues

None at this time.

## Credits

- Problem-solving skills inspired by Amplifier patterns
- Community contributions and feedback
- Extensive testing and iteration on skill effectiveness

---

**Full Changelog:** https://github.com/obra/superpowers/compare/dd013f6...main
**Skills Repository:** https://github.com/obra/superpowers-skills
**Issues:** https://github.com/obra/superpowers/issues
