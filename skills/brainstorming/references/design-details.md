# Brainstorming — Design Details

Extended guidance moved out of `SKILL.md` to keep it concise, and referenced from its Process section.

`SKILL.md` no longer carries a Key Principles list; it states each principle where the principle applies. Four of the five below appear there in substance — multiple choice preferred, YAGNI, explore alternatives, incremental validation. Question style (batching vs. asking alone) is governed by `${CLAUDE_PLUGIN_ROOT}/skills/shared/output-contract.md`, not stated as a principle here. **"Be flexible" appears only here**, so this section is where that one lives rather than a duplicate of the skill.

## Design Quality

**Design for isolation and clarity:**

- Break the system into smaller units that each have one clear purpose, communicate through well-defined interfaces, and can be understood and tested independently
- For each unit, you should be able to answer: what does it do, how do you use it, and what does it depend on?
- Can someone understand what a unit does without reading its internals? Can you change the internals without breaking consumers? If not, the boundaries need work.
- Smaller, well-bounded units are also easier for you to work with - you reason better about code you can hold in context at once, and your edits are more reliable when files are focused. When a file grows large, that's often a signal that it's doing too much.

**Engineering rigor:**

- Verify requirements are complete and unambiguous before designing.
- Identify edge cases, error paths, and cross-platform concerns early.
- Evaluate trade-offs explicitly (performance vs. readability, flexibility vs. simplicity).
- Prioritize modularity, SOLID principles, and production-ready standards.
- Flag architectural risks that will be expensive to fix later.

**Working in existing codebases:**

- Explore the current structure before proposing changes. Follow existing patterns.
- Where existing code has problems that affect the work (e.g., a file that's grown too large, unclear boundaries, tangled responsibilities), include targeted improvements as part of the design - the way a good developer improves code they're working in.
- Don't propose unrelated refactoring. Stay focused on what serves the current goal.
- If the repo lacks `CLAUDE.md` / `AGENTS.md` and long-term collaboration is expected, consider using `superpowers:claude-md-creator` to create a minimal, high-signal context file.

## Key Principles

- **Multiple choice preferred** - Easier to answer than open-ended when possible
- **YAGNI ruthlessly** - Remove unnecessary features from all designs
- **Explore alternatives** - Always propose 2-3 approaches before settling
- **Incremental validation** - Present design, get approval before moving on
- **Be flexible** - Go back and clarify when something doesn't make sense
