#!/usr/bin/env node
/**
 * Model-Tier Dispatch Gate — PreToolUse Hook for Agent
 *
 * Dormant unless the project opts in via docs/superpowers/model-routing.json
 * (or ~/.claude/superpowers/model-routing.json). When active, an Agent
 * dispatch's model must agree with the tier of an in-progress task, resolved
 * through the routing config. Reviewers always run at "standard", so the
 * allowed set is the UNION of every in-progress task's resolved tier plus
 * resolve("standard"). Any member resolving to "inherit" stands the gate down.
 * A task's concrete "model" pin adds that literal to the allowed set.
 *
 * Tasks are keyed strictly by their NATIVE id, extracted from the TaskCreate
 * tool_result text ("Task #N created successfully") — never by creation
 * order, which mis-keys tiers when result ids do not match create sequence.
 *
 * Custom subagent_types (anything other than absent/empty/"general-purpose")
 * are exempt: only implementer/reviewer-grade dispatches are routed.
 *
 * Fail-open by design: missing config, unreadable transcript, malformed
 * lines, unknown tiers, or any internal error -> allow.
 * Kill switch: SUPERPOWERS_ROUTING_GUARD=0.
 *
 * Logs decisions to: ~/.claude/hooks-logs/YYYY-MM-DD.jsonl
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { loadRouting, fenceMeta } from './lib/routing-config.js';
import { configDir } from './lib/config-dir.js';

const LOG_DIR = path.join(configDir(process.env), 'hooks-logs');

function log(data) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), hook: 'pre-agent-model-routing', ...data }) + '\n');
  } catch {}
}

const CREATE_RE = /Task #(\d+) created/;

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && typeof b === 'object' && typeof b.text === 'string')
      .map((b) => b.text)
      .join(' ');
  }
  return '';
}

/**
 * Stream the transcript and build the task table.
 * Returns { tasks: Map<nativeId, {subject, description}>, inProgress: string[] }.
 */
export async function scanTranscript(transcriptPath) {
  const creates = [];        // [toolUseId, {subject, description}] in stream order
  const realId = new Map();  // toolUseId -> native id from the create result
  const inProgress = [];     // native ids, most recent last
  const updDesc = new Map(); // native id -> description carried on a TaskUpdate

  const rl = readline.createInterface({
    input: fs.createReadStream(transcriptPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    // Pre-filter: only lines that can affect the table get JSON-parsed.
    // 'Task #' catches create-result lines without coupling to the harness's
    // exact result wording (CREATE_RE only needs "Task #N created").
    if (!line.includes('TaskCreate') && !line.includes('TaskUpdate') && !line.includes('Task #')) {
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
      if (!block || typeof block !== 'object') continue;
      const input = block.input || {};

      if (block.type === 'tool_use' && block.name === 'TaskCreate') {
        creates.push([block.id, {
          subject: typeof input.subject === 'string' ? input.subject : '',
          description: typeof input.description === 'string' ? input.description : '',
        }]);
      } else if (block.type === 'tool_use' && block.name === 'TaskUpdate') {
        const taskId = String(input.taskId ?? '');
        if (!taskId) continue;
        if (typeof input.description === 'string' && input.description) {
          updDesc.set(taskId, input.description);
        }
        const status = input.status;
        if (status === 'in_progress') {
          const i = inProgress.indexOf(taskId);
          if (i !== -1) inProgress.splice(i, 1);
          inProgress.push(taskId);
        } else if (status === 'completed' || status === 'cancelled' || status === 'deleted') {
          const i = inProgress.indexOf(taskId);
          if (i !== -1) inProgress.splice(i, 1);
        }
      } else if (block.type === 'tool_result') {
        const m = CREATE_RE.exec(resultText(block.content));
        if (m) realId.set(block.tool_use_id, m[1]);
      }
    }
  }

  // Key strictly by native id from the result text. Creates whose result
  // never surfaced stay out of the table (their tier cannot constrain).
  const tasks = new Map();
  for (const [toolUseId, meta] of creates) {
    const nativeId = realId.get(toolUseId);
    if (nativeId !== undefined) tasks.set(nativeId, meta);
  }
  for (const [taskId, description] of updDesc) {
    const existing = tasks.get(taskId) || { subject: '', description: '' };
    existing.description = description;
    tasks.set(taskId, existing);
  }

  return { tasks, inProgress };
}

/**
 * Compute the routing decision for a dispatch model against the task table.
 * Returns { blocked, allowed, constrainedBy, reason }.
 */
export function checkDispatch(routing, tasks, inProgress, dispatchModel) {
  const allowed = [];
  const constrainedBy = []; // { id, subject, tier } of in-progress tasks that constrain
  let anyRequirement = false;

  for (const taskId of inProgress) {
    const task = tasks.get(taskId);
    if (!task) continue;
    const meta = fenceMeta(task.description) || {};

    if (typeof meta.model === 'string' && meta.model.length > 0) {
      anyRequirement = true;
      if (!allowed.includes(meta.model)) allowed.push(meta.model);
      constrainedBy.push({ id: taskId, subject: task.subject, tier: `model=${meta.model}` });
    }

    const tier = meta.modelTier;
    if (typeof tier !== 'string' || !tier) continue;
    anyRequirement = true;
    const resolved = routing[tier];
    // Unknown tier -> drop this member (typos must not brick dispatches).
    if (typeof resolved !== 'string' || !resolved) continue;
    if (resolved === 'inherit') return { blocked: false, allowed: null, constrainedBy: null, reason: null };
    if (!allowed.includes(resolved)) allowed.push(resolved);
    constrainedBy.push({ id: taskId, subject: task.subject, tier });
  }

  // No in-progress task carries a tier or pin -> no constraint.
  if (!anyRequirement || allowed.length === 0) {
    return { blocked: false, allowed: null, constrainedBy: null, reason: null };
  }

  // Reviewers run at "standard" while their task is in progress.
  const standard = routing.standard;
  if (standard === 'inherit') return { blocked: false, allowed: null, constrainedBy: null, reason: null };
  if (typeof standard === 'string' && standard && !allowed.includes(standard)) allowed.push(standard);

  // Absent model param -> inherit -> allow.
  if (typeof dispatchModel !== 'string' || !dispatchModel) {
    return { blocked: false, allowed, constrainedBy, reason: null };
  }
  if (allowed.includes(dispatchModel)) {
    return { blocked: false, allowed, constrainedBy, reason: null };
  }

  const taskLines = constrainedBy.map((t) => `  - Task #${t.id} ('${t.subject}') -> ${t.tier}`);
  return {
    blocked: true,
    allowed,
    constrainedBy,
    reason: [
      'AGENT DISPATCH DOES NOT MATCH TASK MODEL TIER',
      '',
      `Your Agent call passed model='${dispatchModel}', but the in-progress task(s) constrain`,
      `dispatches to: ${allowed.join(', ')} (per docs/superpowers/model-routing.json).`,
      '',
      'Constraining in-progress task(s):',
      ...taskLines,
      '',
      'Allowed dispatches:',
      `  - implementer / fix dispatches -> the model of the task they serve (one of: ${allowed.join(', ')})`,
      `  - spec & code-quality reviewers -> ${typeof standard === 'string' && standard ? standard : '(tier "standard" not mapped)'}`,
      '  - final whole-plan reviewer runs after all tasks complete; this gate will not fire then',
      '',
      'Options:',
      `  1. Re-issue the Agent call with a model from the allowed set: ${allowed.join(', ')}.`,
      '  2. If a tier is wrong, update that task\'s metadata via TaskUpdate transparently, then retry.',
      '  3. Escalate to the user via AskUserQuestion if the routing mapping itself is wrong.',
      '',
      'Tier rules: docs/model-routing-flow.md. Runtime disable: SUPERPOWERS_ROUTING_GUARD=0.',
    ].join('\n'),
  };
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  try {
    const data = JSON.parse(input);
    const { tool_name, tool_input, cwd, transcript_path, session_id } = data;

    if (tool_name !== 'Agent') {
      process.stdout.write('{}');
      return;
    }

    // Custom agent types are exempt; only implementer/reviewer-grade dispatches are routed.
    const agentType = tool_input?.subagent_type;
    if (typeof agentType === 'string' && agentType && agentType !== 'general-purpose') {
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

    const { tasks, inProgress } = await scanTranscript(transcript_path);
    const result = checkDispatch(routing, tasks, inProgress, tool_input?.model);

    if (result.blocked) {
      log({ level: 'BLOCKED', model: tool_input?.model, allowed: result.allowed, inProgress, session_id, cwd });
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: result.reason,
        },
      }));
      return;
    }

    process.stdout.write('{}');
  } catch (e) {
    log({ level: 'ERROR', error: e.message });
    process.stdout.write('{}');
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main();
}
