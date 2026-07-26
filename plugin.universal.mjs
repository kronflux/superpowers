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
      event: 'Stop',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/stop-reminders.js"',
      platforms: ['claude-code', 'codex'],
    },
    {
      event: 'SubagentStop',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/subagent-guard.js"',
      platforms: ['claude-code'],
    },
    {
      event: 'SessionStart',
      command: './hooks/run-hook.cmd session-start',
      platforms: ['cursor'],
    },
  ],
};
