#!/usr/bin/env node
/**
 * Subagent Guard — SubagentStop Hook (namespace-scoped to superpowers:).
 *
 * Blocks a subagent from stopping if it invoked a superpowers skill or spawned
 * sub-subagents. Detection is scoped strictly to the superpowers namespace, so
 * context-mode and other-plugin skill/tool references are NOT flagged
 * (spec §6.3, criterion 6).
 *
 * Three coexistence-safe match forms only:
 *   1. A `superpowers:`-namespaced reference (Skill(superpowers:...) or
 *      `superpowers:<known-skill>`).
 *   2. A bare `Skill(<known-skill>)` call without the `superpowers:` prefix —
 *      safe to flag because the known names are superpowers-specific.
 *   3. An action verb (invoke/use/run/...) immediately before a known
 *      superpowers skill name. The broad bare `skill:` prose pattern from the
 *      upstream source is dropped — it false-positived on other plugins.
 *
 * Logs violations to: ~/.claude/hooks-logs/subagent-violations.jsonl
 * Fail-open on parse error.
 */

import fs from 'fs';
import path from 'path';

// MUST stay in sync with the skill directories under skills/ (excluding
// shared/). One entry per shipped superpowers skill. Sorted alphabetically for
// maintainability. When a skill is added/removed under skills/, update here.
const SKILL_NAMES = [
  'brainstorming',
  'checking-gates',
  'claude-md-creator',
  'context-management',
  'deliberation',
  'dependency-management',
  'dispatching-parallel-agents',
  'error-recovery',
  'executing-plans',
  'finishing-a-development-branch',
  'frontend-design',
  'performance-investigation',
  'premise-check',
  'receiving-code-review',
  'refactoring',
  'requesting-code-review',
  'self-consistency-reasoner',
  'specifying-gates',
  'subagent-driven-development',
  'systematic-debugging',
  'test-driven-development',
  'token-efficiency',
  'using-git-worktrees',
  'using-superpowers',
  'verification-before-completion',
  'writing-plans',
  'writing-skills',
];

const ACTION_VERB =
  '(?:invoking?|using|use|running?|called?|calling|activat(?:e|ed|ing)|' +
  'trigger(?:ing|ed)?|execut(?:e|ed|ing)|launch(?:ing|ed)?|spawn(?:ing|ed)?|' +
  'start(?:ing|ed)?)\\s+(?:the\\s+)?';

// Only superpowers-namespaced, action-verb + known-skill, or bare
// Skill(<known-skill>) forms. No bare "skill:" prose match (that flagged other
// plugins). Bare Skill(<name>) is safe to flag because the known names are
// superpowers-specific.
const VIOLATION_PATTERNS = [
  /Skill\s*\(\s*["']?superpowers:/i,
  new RegExp('\\bsuperpowers:(?:' + SKILL_NAMES.join('|') + ')\\b', 'i'),
  new RegExp('Skill\\s*\\(\\s*["\']?(?:' + SKILL_NAMES.join('|') + ')\\b', 'i'),
  ...SKILL_NAMES.map(name => new RegExp(ACTION_VERB + name + '\\b', 'i')),
];

function logViolation(agentId, agentType, matchedPattern) {
  try {
    const logDir = path.join(process.env.HOME || process.env.USERPROFILE || '', '.claude', 'hooks-logs');
    fs.mkdirSync(logDir, { recursive: true });
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      agentId, agentType, matchedPattern: matchedPattern.toString(), action: 'blocked',
    }) + '\n';
    fs.appendFileSync(path.join(logDir, 'subagent-violations.jsonl'), entry);
  } catch {
    // Logging must never break the hook
  }
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => { input += c; });
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input);
      const lastMessage = data.last_assistant_message || '';
      const agentId = data.agent_id || 'unknown';
      const agentType = data.agent_type || 'unknown';
      for (const pattern of VIOLATION_PATTERNS) {
        if (pattern.test(lastMessage)) {
          logViolation(agentId, agentType, pattern);
          process.stdout.write(JSON.stringify({
            decision: 'block',
            reason: [
              'SKILL LEAKAGE DETECTED: You invoked a superpowers skill, which is not allowed for subagents.',
              'Redo your assigned task using only your core tools (Read, Edit, Write, Bash, Grep, Glob).',
              'Do NOT invoke the Skill tool. Do NOT reference any superpowers skills.',
              'Focus only on the task you were given.',
            ].join(' '),
          }));
          return;
        }
      }
      process.stdout.write('{}');
    } catch {
      process.stdout.write('{}');
    }
  });
}

main();
