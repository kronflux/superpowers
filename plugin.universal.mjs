// Single source of truth for hook registration. Edit THIS file, then
// `npm run compile-hooks`. Never hand-edit hooks/*.json.
//
// Each entry: { event, matcher?, command, async?, platforms }
//   platforms: 'claude-code' -> hooks/hooks.json
//              'codex'       -> hooks/codex-hooks.json
//              'cursor'      -> hooks/hooks-cursor.json
// Entry order is preserved per platform and determines output order.

export default {
  meta: { name: 'superpowers', version: '7.1.0' },
  hooks: [
    {
      event: 'SessionStart',
      matcher: 'startup|clear|compact',
      command: '"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" session-start',
      // The command opens with a quoted path, which PowerShell parses as an
      // expression and cmd.exe truncates at a metacharacter. Both fail before
      // run-hook.cmd runs, so the polyglot header cannot rescue it.
      shell: 'bash',
      async: false,
      platforms: ['claude-code'],
    },
    {
      event: 'SessionStart',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/context-engine.js"',
      async: true,
      platforms: ['claude-code'],
    },
    {
      event: 'SessionStart',
      matcher: 'startup|resume',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/context-engine.js"',
      platforms: ['codex'],
    },
    {
      event: 'UserPromptSubmit',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/skill-activator.js"',
      platforms: ['claude-code', 'codex'],
    },
    {
      event: 'PreToolUse',
      matcher: 'Bash',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/safety/block-dangerous-commands.js"',
      platforms: ['claude-code', 'codex'],
    },
    {
      event: 'PreToolUse',
      matcher: 'Read|Edit|Write|Bash',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/safety/protect-secrets.js"',
      platforms: ['claude-code'],
    },
    {
      event: 'PreToolUse',
      matcher: 'Bash',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/bash-compress-hook.js"',
      platforms: ['claude-code'],
    },
    {
      event: 'PreToolUse',
      matcher: 'Edit|Write',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/comment-gate.js"',
      platforms: ['claude-code'],
    },
    {
      event: 'PreToolUse',
      matcher: 'Bash',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/commit-message-gate.js"',
      platforms: ['claude-code'],
    },
    {
      event: 'PreToolUse',
      matcher: 'Grep|Glob|Read',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/conductor-nudges.js"',
      platforms: ['claude-code'],
    },
    {
      // Edit moved to PostToolUse: the LSP offer is about what happens AFTER an
      // edit, and a PostToolUse hook cannot delay the edit itself.
      event: 'PostToolUse',
      matcher: 'Bash|Edit',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/conductor-nudges.js"',
      platforms: ['claude-code'],
    },
    {
      event: 'PostToolUse',
      matcher: 'Bash',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/safety/record-ask-approval.js"',
      platforms: ['claude-code', 'codex'],
    },
    {
      // TaskCreate is a Claude Code-native tool; routing stays claude-code-only.
      event: 'PreToolUse',
      matcher: 'TaskCreate',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/pre-taskcreate-model-tier.js"',
      platforms: ['claude-code'],
    },
    {
      // Model-tier routing for Claude Code's Agent tool; claude-code-only by design.
      event: 'PreToolUse',
      matcher: 'Agent',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/pre-agent-model-routing.js"',
      platforms: ['claude-code'],
    },
    {
      // AskUserQuestion is a Claude Code-native tool; routing stays claude-code-only.
      event: 'PreToolUse',
      matcher: 'AskUserQuestion',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/pre-askuser-handoff-guard.js"',
      platforms: ['claude-code'],
    },
    {
      event: 'PostToolUse',
      matcher: 'Edit|Write',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/track-edits.js"',
      platforms: ['claude-code'],
    },
    {
      event: 'PostToolUse',
      matcher: 'Skill',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/track-session-stats.js"',
      platforms: ['claude-code'],
    },
    {
      // Automates the "Task Persistence Sync" step that controller-operations.md
      // has documented all along and that no controller has ever performed —
      // 9 of 11 plan snapshots in this repo still read 0/N. Cross-session resume
      // and the statusline's plan segment both read that file.
      event: 'PostToolUse',
      matcher: 'TaskUpdate',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/sync-plan-tasks.js"',
      platforms: ['claude-code'],
    },
    {
      event: 'Stop',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/stop-reminders.js"',
      platforms: ['claude-code', 'codex'],
    },
    {
      event: 'Stop',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/usage-aggregator.js"',
      platforms: ['claude-code'],
    },
    {
      event: 'SubagentStop',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/subagent-guard.js"',
      platforms: ['claude-code'],
    },
    {
      event: 'SessionEnd',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/session-end-cleanup.js"',
      platforms: ['claude-code'],
    },
    {
      event: 'SessionStart',
      command: './hooks/run-hook.cmd session-start',
      platforms: ['cursor'],
    },
  ],
};
