#!/usr/bin/env node
/**
 * Model-Tier Plan Gate — PreToolUse Hook for TaskCreate
 *
 * When the project opts in to model routing (docs/superpowers/model-routing.json
 * exists), every plan-shaped task MUST carry a valid "modelTier" in its
 * ```json:metadata fence, one of the four tiers: mechanical, standard,
 * advanced, frontier. Ad-hoc tasks are unaffected. A concrete "model" pin
 * in the fence overrides tier enforcement. A "frontier" tier request is
 * rejected outright when the routing config has the frontier tier off.
 *
 * Fail-open by design: missing config, malformed fence JSON, or any internal
 * error -> allow. A determinate "frontier is off" rejection is not a fault.
 * Kill switch: SUPERPOWERS_ROUTING_GUARD=0.
 *
 * Logs decisions to: ~/.claude/hooks-logs/YYYY-MM-DD.jsonl
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadRouting, fenceMeta, TIERS } from './lib/routing-config.js';
import { configDir } from './lib/config-dir.js';

const LOG_DIR = path.join(configDir(process.env), 'hooks-logs');

function log(data) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), hook: 'pre-taskcreate-model-tier', ...data }) + '\n');
  } catch {}
}

const PLAN_HEADERS_RE = /\*\*(Goal|Acceptance Criteria|Verify):\*\*/;
const PLAN_SUBJECT_RE = /^(Task|Phase|Gate|Step|Milestone) ?\d/;

const TIER_TABLE = [
  'Pick ONE modelTier:',
  '  "mechanical" - touches 1-2 files, complete spec with code in the steps, no design judgment.',
  '  "standard"   - multi-file coordination, integration concerns, pattern matching, debugging.',
  '  "advanced"   - design judgment, architecture decisions, broad codebase understanding.',
  '                 This is the DEFAULT CEILING for hard work.',
  '  "frontier"   - gated, 2x cost. Requires user approval per task, and only qualifies when',
  '                 the task shows a documented frontier-model edge:',
  '                   1. long-horizon autonomous execution (hours unattended, no checkpoint)',
  '                   2. first-shot build of a fully-specified large system',
  '                   3. genuine ambiguity - the model must choose the frame',
  '                   4. whole-repo review/debugging including history',
  '                   5. wide parallel sub-agent coordination',
  '                   6. dense or degraded visual input',
  '                 INVERSE TEST: if the advanced tier has plausibly handled this CLASS of',
  '                 task before, it is not frontier. Difficulty alone never qualifies.',
  '                 NEVER frontier: security-focused analysis (classifier refusals),',
  '                 zero-data-retention orgs, prefill, latency-sensitive work.',
  '',
  'Tie-break: spec completeness wins - a task whose steps contain the complete code',
  'is "mechanical" regardless of file count. When the user pinned a specific model,',
  'set "model" instead (it overrides the tier).',
  '',
  'Escalation goes up only and STOPS AT "advanced". Reaching "frontier" always requires',
  'the user approval flow in skills/writing-plans - never automatic escalation.',
  '',
  'Options:',
  '  1. Re-issue TaskCreate with a "modelTier" in the ```json:metadata fence.',
  '  2. If this is genuinely an ad-hoc task (not part of a plan), rephrase the subject',
  '     without the numbered-plan prefix and without template headers, then retry.',
  '  3. If routing should not apply here, delete docs/superpowers/model-routing.json.',
  '',
  'Rationale: docs/model-routing-flow.md. Runtime disable: SUPERPOWERS_ROUTING_GUARD=0.',
].join('\n');

/**
 * Decide for a TaskCreate input. Returns { blocked, reason }.
 * routing is the parsed model-routing config (non-null when routing is active).
 */
export function checkTaskCreate(toolInput, routing) {
  const description = typeof toolInput?.description === 'string' ? toolInput.description : '';
  const subject = typeof toolInput?.subject === 'string' ? toolInput.subject : '';

  const planShaped = PLAN_HEADERS_RE.test(description) || PLAN_SUBJECT_RE.test(subject);
  if (!planShaped) return { blocked: false, reason: null };

  const hasFence = /```json:metadata/.test(description);
  if (!hasFence) {
    return {
      blocked: true,
      reason: [
        'PLAN TASK MISSING METADATA FENCE',
        '',
        `This project has opted in to subagent model routing, and the TaskCreate for '${subject}'`,
        'is plan-shaped but its description carries no ```json:metadata fence. Plan tasks MUST',
        'follow the full structured body (see skills/shared/task-format-reference.md), ending',
        'with a json:metadata fence that includes a "modelTier".',
        '',
        TIER_TABLE,
      ].join('\n'),
    };
  }

  const meta = fenceMeta(description);
  // Unparseable fence JSON -> fail open (malformed fences are someone else's problem).
  if (meta === null) return { blocked: false, reason: null };

  // Concrete model pin overrides tier enforcement.
  if (typeof meta.model === 'string' && meta.model.length > 0) {
    return { blocked: false, reason: null };
  }

  if (TIERS.includes(meta.modelTier)) {
    if (meta.modelTier === 'frontier' && routing && routing.frontier === 'off' && routing.schema !== 1) {
      return {
        blocked: true,
        reason: [
          'FRONTIER TIER IS NOT ENABLED',
          '',
          `The TaskCreate for '${subject}' requests modelTier "frontier", but this project's`,
          'routing config has the frontier tier off. Frontier is opt-in because it costs 2x',
          'the advanced tier.',
          '',
          'Options:',
          '  1. Use "advanced" instead - it is the default ceiling and handles design judgment,',
          '     architecture decisions, and broad codebase understanding.',
          '  2. To enable frontier, add "schema": 2 and a "frontier" model to the routing config,',
          '     then re-run the user approval flow in skills/writing-plans.',
          '',
          TIER_TABLE,
        ].join('\n'),
      };
    }
    return { blocked: false, reason: null };
  }

  const problem = meta.modelTier === undefined || meta.modelTier === ''
    ? 'has none'
    : `has invalid value '${meta.modelTier}'`;
  return {
    blocked: true,
    reason: [
      'PLAN TASK MISSING MODEL TIER',
      '',
      'This project has opted in to subagent model routing (docs/superpowers/model-routing.json),',
      `so every plan task's json:metadata fence MUST carry a "modelTier". The TaskCreate for`,
      `'${subject}' ${problem}.`,
      '',
      TIER_TABLE,
    ].join('\n'),
  };
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  try {
    const data = JSON.parse(input);
    const { tool_name, tool_input, cwd, session_id } = data;

    if (tool_name !== 'TaskCreate') {
      process.stdout.write('{}');
      return;
    }

    const routing = loadRouting(cwd);
    if (!routing) {
      process.stdout.write('{}');
      return;
    }

    const result = checkTaskCreate(tool_input, routing);
    if (result.blocked) {
      log({ level: 'BLOCKED', subject: tool_input?.subject, session_id, cwd });
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
