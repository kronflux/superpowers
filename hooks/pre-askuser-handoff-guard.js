#!/usr/bin/env node
/**
 * Execution Handoff Guard — PreToolUse Hook for AskUserQuestion
 *
 * Dormant unless the project opts in via .superpowers/model-routing.json
 * (or the legacy docs/superpowers/model-routing.json, or
 * ~/.claude/superpowers/model-routing.json). When active, and after
 * writing-plans has been invoked and tasks created, the only permitted
 * AskUserQuestion at the handoff point is the mandated two-option Execution
 * Handoff ("Subagent-Driven (this session)" / "Parallel Session (separate)").
 * Improvised menus bypass the subagent pipeline where model routing operates.
 *
 * Armed iff: a writing-plans Skill invocation appears in the transcript,
 * followed later by a TaskCreate, with no subsequent executing-plans /
 * subagent-driven-development invocation and no prior compliant handoff.
 *
 * Escape hatch for legitimate mid-plan questions: include the literal token
 * CLARIFICATION in the question text.
 *
 * Fail-open by design: missing config, unreadable transcript, malformed
 * lines, or any internal error -> allow. Kill switch: SUPERPOWERS_ROUTING_GUARD=0.
 *
 * Logs decisions to: ~/.claude/hooks-logs/YYYY-MM-DD.jsonl
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { loadRouting } from './lib/routing-config.js';
import { configDir } from './lib/config-dir.js';
import { dedupeReason } from './lib/rejection-dedup.js';

const LOG_DIR = path.join(configDir(process.env), 'hooks-logs');

function log(data) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), hook: 'pre-askuser-handoff-guard', ...data }) + '\n');
  } catch {}
}

function isWritingPlansSkill(skill) {
  return typeof skill === 'string'
    && (skill.includes('writing-plans') || skill === 'write-plan' || skill.endsWith(':write-plan'));
}

function isExecutionSkill(skill) {
  return typeof skill === 'string'
    && (skill.includes('executing-plans')
      || skill.includes('subagent-driven-development')
      || skill === 'execute-plan' || skill.endsWith(':execute-plan'));
}

export function optionLabels(questions) {
  const q0 = Array.isArray(questions) && questions[0] && typeof questions[0] === 'object' ? questions[0] : {};
  const options = Array.isArray(q0.options) ? q0.options : [];
  return options.map((o) => {
    if (o && typeof o === 'object') return String(o.label ?? o.text ?? o.value ?? '');
    return String(o ?? '');
  });
}

export function isCompliantHandoff(questions) {
  const labels = optionLabels(questions);
  return labels.some((l) => l.includes('Subagent-Driven')) && labels.some((l) => l.includes('Parallel Session'));
}

/**
 * Stream the transcript and decide whether the guard is armed.
 * Returns true iff the last writing-plans invocation is followed by a
 * TaskCreate, with no execution-skill invocation or compliant handoff after it.
 */
export async function scanArmedState(transcriptPath) {
  let armPos = null;
  let disarmPos = null;
  let lastTaskCreatePos = null;
  let pos = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(transcriptPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    pos += 1;
    // Pre-filter: only lines that can change arm/disarm state get JSON-parsed.
    if (!line.includes('Skill') && !line.includes('TaskCreate') && !line.includes('AskUserQuestion')) {
      continue;
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue; // one malformed line poisons only itself
    }
    const content = event?.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (!block || typeof block !== 'object' || block.type !== 'tool_use') continue;
      const input = block.input || {};

      if (block.name === 'Skill') {
        if (isWritingPlansSkill(input.skill)) armPos = pos;
        if (isExecutionSkill(input.skill)) disarmPos = pos;
      } else if (block.name === 'TaskCreate') {
        lastTaskCreatePos = pos;
      } else if (block.name === 'AskUserQuestion') {
        // A prior compliant handoff disarms subsequent questions.
        if (isCompliantHandoff(input.questions)) disarmPos = pos;
      }
    }
  }

  return (
    armPos !== null
    && (disarmPos === null || disarmPos < armPos)
    && lastTaskCreatePos !== null
    && lastTaskCreatePos > armPos
  );
}

const HANDOFF_BLOCK = [
  'EXECUTION HANDOFF VIOLATION - WRONG AskUserQuestion STRUCTURE',
  '',
  'writing-plans was invoked and tasks were created, but this AskUserQuestion is not',
  'the mandated Execution Handoff. Exactly one structure is permitted here.',
  '',
  'Required structure (copy this exactly):',
  '',
  '  AskUserQuestion:',
  '    question: "Plan complete and saved to .superpowers/plans/<filename>.md. How would you like to execute it?"',
  '    header: "Execution"',
  '    options:',
  '      - label: "Subagent-Driven (this session)"',
  '        description: "I dispatch fresh subagent per task, review between tasks, fast iteration"',
  '      - label: "Parallel Session (separate)"',
  '        description: "Open new session in worktree with executing-plans, batch execution with checkpoints"',
  '',
  'Options:',
  '  1. Re-issue AskUserQuestion with exactly that structure. Both options feed the',
  '     subagent pipeline where model routing and task dispatch operate.',
  '  2. If this is a genuine mid-plan clarification (not the handoff), include the',
  '     literal token CLARIFICATION in the question text and retry.',
  '  3. Runtime disable: SUPERPOWERS_ROUTING_GUARD=0.',
  '',
  'Handoff rationale: docs/model-routing-flow.md.',
].join('\n');

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  try {
    const data = JSON.parse(input);
    const { tool_name, tool_input, cwd, transcript_path, session_id } = data;

    if (tool_name !== 'AskUserQuestion') {
      process.stdout.write('{}');
      return;
    }

    const routing = loadRouting(cwd);
    if (!routing) {
      process.stdout.write('{}');
      return;
    }

    if (typeof transcript_path !== 'string' || !transcript_path || !fs.existsSync(transcript_path)) {
      process.stdout.write('{}');
      return;
    }

    const armed = await scanArmedState(transcript_path);
    if (!armed) {
      process.stdout.write('{}');
      return;
    }

    const questions = tool_input?.questions;
    const questionText = Array.isArray(questions) && questions[0] && typeof questions[0] === 'object'
      ? String(questions[0].question ?? '')
      : '';

    if (questionText.includes('CLARIFICATION') || isCompliantHandoff(questions)) {
      process.stdout.write('{}');
      return;
    }

    log({ level: 'BLOCKED', question: questionText.slice(0, 200), session_id, cwd });
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: dedupeReason({
          sessionId: session_id,
          hook: 'askuser-guard',
          ruleId: 'handoff-violation',
          reason: HANDOFF_BLOCK,
          subject: questionText.slice(0, 80) || '(no question text)',
        }),
      },
    }));
  } catch (e) {
    log({ level: 'ERROR', error: e.message });
    process.stdout.write('{}');
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main();
}
