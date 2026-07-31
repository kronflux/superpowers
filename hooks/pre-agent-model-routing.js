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
 * The "frontier" tier is gated separately and never joins that allowed set. A
 * dispatch on the frontier model is denied unless TWO independent signals
 * agree: a "frontierConsent": "FRONTIER-APPROVED:task-<N>" token in the fence
 * of an in-progress frontier task, AND the same token in a transcript
 * tool_result. Fences are agent-writable, so they prove nothing alone;
 * tool_result blocks are authored by the harness (the user picking an
 * AskUserQuestion option whose label carries the token), which is what makes
 * this corroboration rather than self-assertion. The consent check is the
 * first statement in checkDispatch, ahead of the "inherit" stand-down:
 * standing down relaxes tier matching, never consent.
 *
 * Tasks are keyed strictly by their NATIVE id, extracted from the TaskCreate
 * tool_result text ("Task #N created successfully") — never by creation
 * order, which mis-keys tiers when result ids do not match create sequence.
 * A task's description resolves chronologically: the latest description-
 * bearing event (TaskCreate or TaskUpdate) for that native id wins, so a
 * stale TaskUpdate from earlier in the session (e.g. a reused native id
 * after a task-list clear) can never clobber a later TaskCreate's fence.
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

// Consent tokens are read ONLY from tool_result blocks, which are authored by
// the harness. An agent can emit a tool_use but cannot forge a tool_result,
// which is what makes this corroboration rather than self-assertion.
const CONSENT_RE = /FRONTIER-APPROVED:task-\d+/g;

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
 * Returns { tasks: Map<nativeId, {subject, description}>, inProgress: string[],
 * consentTokens: Set<string> }.
 */
export async function scanTranscript(transcriptPath) {
  let seq = 0;               // monotonic event counter: stream position IS chronology
  const creates = [];        // [toolUseId, {subject, description, seq}] in stream order
  const realId = new Map();  // toolUseId -> native id from the create result
  const inProgress = [];     // native ids, most recent last
  const updDesc = new Map(); // native id -> {description, seq} of the LATEST update
  const consentTokens = new Set(); // harness-authored frontier approval tokens

  const rl = readline.createInterface({
    input: fs.createReadStream(transcriptPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    // Pre-filter: only lines that can affect the table get JSON-parsed.
    // 'Task #' catches create-result lines without coupling to the harness's
    // exact result wording (CREATE_RE only needs "Task #N created").
    if (!line.includes('TaskCreate') && !line.includes('TaskUpdate')
        && !line.includes('Task #') && !line.includes('FRONTIER-APPROVED')) {
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
          seq: seq++,
        }]);
      } else if (block.type === 'tool_use' && block.name === 'TaskUpdate') {
        const taskId = String(input.taskId ?? '');
        if (!taskId) continue;
        if (typeof input.description === 'string' && input.description) {
          updDesc.set(taskId, { description: input.description, seq: seq++ });
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
        const text = resultText(block.content);
        const m = CREATE_RE.exec(text);
        if (m) realId.set(block.tool_use_id, m[1]);
        for (const tok of text.match(CONSENT_RE) || []) consentTokens.add(tok);
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
  // Latest description-bearing event wins, by stream position. A stale
  // TaskUpdate from earlier in the session (e.g. a reused native id after a
  // task-list clear) must never clobber a later TaskCreate's fence.
  for (const [taskId, upd] of updDesc) {
    const existing = tasks.get(taskId);
    if (!existing) {
      tasks.set(taskId, { subject: '', description: upd.description, seq: upd.seq });
    } else if (upd.seq > existing.seq) {
      existing.description = upd.description;
    }
  }

  return { tasks, inProgress, consentTokens };
}

/**
 * Frontier dispatches require BOTH a fence token on an in-progress frontier
 * task AND a matching harness-authored token in the transcript. Runs before
 * the "inherit" stand-down: standing down relaxes tier matching, never consent.
 */
function frontierConsentBlock(routing, tasks, inProgress, dispatchModel, consentTokens) {
  const frontierModel = routing.frontier;
  if (typeof frontierModel !== 'string' || !frontierModel) return null;
  if (frontierModel === 'off' || frontierModel === 'inherit') return null;
  if (dispatchModel !== frontierModel) return null;

  for (const taskId of inProgress) {
    const task = tasks.get(taskId);
    if (!task) continue;
    const meta = fenceMeta(task.description) || {};
    if (meta.modelTier !== 'frontier') continue;
    const token = typeof meta.frontierConsent === 'string' ? meta.frontierConsent : '';
    if (token && consentTokens.has(token)) return null;
  }

  return {
    blocked: true,
    allowed: null,
    constrainedBy: null,
    reason: [
      'FRONTIER DISPATCH WITHOUT RECORDED USER APPROVAL',
      '',
      `This dispatch requests model='${dispatchModel}', the frontier tier. Frontier costs 2x`,
      'the advanced tier, so it requires explicit per-task user approval that this session',
      'has no record of.',
      '',
      'Approval requires BOTH:',
      '  1. "frontierConsent": "FRONTIER-APPROVED:task-<N>" in the task\'s json:metadata fence',
      '  2. A matching AskUserQuestion answer in this transcript',
      '',
      'To obtain it, run the frontier offer from skills/writing-plans. The offer MUST state:',
      '  - which task, named',
      '  - why frontier is better here, citing the specific qualifying signal for THIS task',
      '  - the cost, plainly: 2x the advanced tier',
      '  - the counter-case: what advanced would very likely handle, and what is at risk',
      '  - two options, with advanced as the default',
      'The approval option label must contain the token verbatim; the question text and the',
      'other option must NOT contain it.',
      '',
      'Or simply re-issue this dispatch at the advanced tier, which needs no approval.',
      '',
      'Tier rules: docs/model-routing-flow.md. Runtime disable: SUPERPOWERS_ROUTING_GUARD=0.',
    ].join('\n'),
  };
}

/**
 * Compute the routing decision for a dispatch model against the task table.
 * Returns { blocked, allowed, constrainedBy, reason }.
 */
export function checkDispatch(routing, tasks, inProgress, dispatchModel, consentTokens = new Set()) {
  const consentDenial = frontierConsentBlock(routing, tasks, inProgress, dispatchModel, consentTokens);
  if (consentDenial) return consentDenial;

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
    // Legacy-normalized configs (schema 1): a fence tagged with the pre-7.3
    // tier name "frontier" keeps its old meaning - the top tier, now
    // "advanced". Only schema-2 configs treat "frontier" as the gated tier.
    const resolved = (tier === 'frontier' && routing.schema === 1) ? routing.advanced : routing[tier];
    // Unknown tier -> drop this member (typos must not brick dispatches).
    if (typeof resolved !== 'string' || !resolved) continue;
    if (resolved === 'off') continue;
    if (resolved === 'inherit') return { blocked: false, allowed: null, constrainedBy: null, reason: null };
    // The frontier model is admitted only by the consent path above, never by
    // the general allowed-set union. Keyed on the TIER NAME, not the resolved
    // model: a config mapping advanced and frontier to the same model must not
    // starve advanced tasks of an allowed entry. (Such configs are rejected at
    // load, but this function also takes literal objects in tests.)
    if (tier === 'frontier' && routing.schema !== 1) continue;
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

    const { tasks, inProgress, consentTokens } = await scanTranscript(transcript_path);
    const result = checkDispatch(routing, tasks, inProgress, tool_input?.model, consentTokens);

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
