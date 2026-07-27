import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOKS = {
  taskcreate: path.join(__dirname, '..', 'hooks', 'pre-taskcreate-model-tier.js'),
  agent: path.join(__dirname, '..', 'hooks', 'pre-agent-model-routing.js'),
  askuser: path.join(__dirname, '..', 'hooks', 'pre-askuser-handoff-guard.js'),
};

// Isolated home: the ~/.claude/superpowers fallback must never see a real
// user config, and hook telemetry must never touch real ~/.claude/hooks-logs.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-routing-home-'));
const tmpDirs = [tmpHome];
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

const ROUTING = { mechanical: 'haiku', standard: 'sonnet', frontier: 'inherit' };

function makeProject(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-routing-proj-'));
  tmpDirs.push(dir);
  if (config !== undefined) {
    const cfgDir = path.join(dir, 'docs', 'superpowers');
    fs.mkdirSync(cfgDir, { recursive: true });
    const body = typeof config === 'string' ? config : JSON.stringify(config);
    fs.writeFileSync(path.join(cfgDir, 'model-routing.json'), body);
  }
  return dir;
}

function makeProfile(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-routing-profile-'));
  tmpDirs.push(dir);
  const cfgDir = path.join(dir, 'superpowers');
  fs.mkdirSync(cfgDir, { recursive: true });
  const body = typeof config === 'string' ? config : JSON.stringify(config);
  fs.writeFileSync(path.join(cfgDir, 'model-routing.json'), body);
  return dir;
}

// Probe script: calls loadRouting/routingSource in a fresh subprocess so
// os.homedir()-backed legacy-candidate resolution honours the subprocess's
// own HOME/USERPROFILE rather than this test runner's real environment.
const routingLibUrl = pathToFileURL(path.join(__dirname, '..', 'hooks', 'lib', 'routing-config.js')).href;
const probeScript = path.join(tmpHome, 'load-routing-probe.mjs');
fs.writeFileSync(
  probeScript,
  `import { loadRouting, routingSource } from '${routingLibUrl}';\n` +
    'const routing = loadRouting(process.argv[2], process.env);\n' +
    'process.stdout.write(JSON.stringify({ routing, source: routingSource() }));\n'
);

function loadRoutingProbe(cwd, envOverrides = {}) {
  const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
  delete env.SUPERPOWERS_ROUTING_GUARD;
  delete env.CLAUDE_CONFIG_DIR;
  Object.assign(env, envOverrides);
  const out = execFileSync('node', [probeScript, cwd], { encoding: 'utf8', env });
  return JSON.parse(out);
}

let transcriptCount = 0;
function makeTranscript(lines) {
  const file = path.join(tmpHome, `transcript-${transcriptCount++}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
}

function toolUse(name, input, id) {
  return { type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } };
}

function toolResult(toolUseId, text) {
  return { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: [{ type: 'text', text }] }] } };
}

function planDescription(fence) {
  const lines = ['**Goal:** Do the thing.', '', '**Verify:** `npm test`'];
  if (fence !== undefined) {
    lines.push('', '```json:metadata', JSON.stringify(fence), '```');
  }
  return lines.join('\n');
}

function run(hook, payload, envOverrides = {}) {
  const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome, ...envOverrides };
  delete env.SUPERPOWERS_ROUTING_GUARD;
  if (envOverrides.SUPERPOWERS_ROUTING_GUARD !== undefined) {
    env.SUPERPOWERS_ROUTING_GUARD = envOverrides.SUPERPOWERS_ROUTING_GUARD;
  }
  // Isolate from any real CLAUDE_CONFIG_DIR inherited from the outer shell —
  // otherwise routing-config's source log would land outside tmpHome.
  delete env.CLAUDE_CONFIG_DIR;
  if (envOverrides.CLAUDE_CONFIG_DIR !== undefined) {
    env.CLAUDE_CONFIG_DIR = envOverrides.CLAUDE_CONFIG_DIR;
  }
  const out = execFileSync('node', [HOOKS[hook]], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env,
  });
  return JSON.parse(out);
}

function decision(json) {
  return json.hookSpecificOutput?.permissionDecision ?? 'allow';
}

// --- shared fixture payloads that WOULD deny when routing is active ---

function denyingTaskCreate(cwd) {
  return {
    tool_name: 'TaskCreate',
    cwd,
    tool_input: { subject: 'Task 1: build the widget', description: planDescription({ files: [] }) },
  };
}

function mechanicalInProgressTranscript() {
  return makeTranscript([
    toolUse('TaskCreate', { subject: 'Task 1: mech work', description: planDescription({ modelTier: 'mechanical' }) }, 'tu1'),
    toolResult('tu1', 'Task #1 created successfully.'),
    toolUse('TaskUpdate', { taskId: '1', status: 'in_progress' }, 'tu2'),
  ]);
}

function denyingAgent(cwd, transcript) {
  return {
    tool_name: 'Agent',
    cwd,
    transcript_path: transcript,
    tool_input: { description: 'impl', prompt: 'do it', model: 'opus' },
  };
}

function armedTranscript(extraLines = []) {
  return makeTranscript([
    toolUse('Skill', { skill: 'superpowers:writing-plans' }, 'tu1'),
    toolUse('TaskCreate', { subject: 'Task 1: x', description: planDescription({ modelTier: 'mechanical' }) }, 'tu2'),
    ...extraLines,
  ]);
}

function denyingAskUser(cwd, transcript) {
  return {
    tool_name: 'AskUserQuestion',
    cwd,
    transcript_path: transcript,
    tool_input: {
      questions: [{
        question: 'Which phase should we start with?',
        options: [{ label: 'Phase 1' }, { label: 'Phase 2' }, { label: 'All phases' }],
      }],
    },
  };
}

describe('self-gating (all three hooks)', () => {
  it('no config anywhere: allows payloads that would otherwise deny', () => {
    const cwd = makeProject(undefined);
    expect(decision(run('taskcreate', denyingTaskCreate(cwd)))).toBe('allow');
    expect(decision(run('agent', denyingAgent(cwd, mechanicalInProgressTranscript())))).toBe('allow');
    expect(decision(run('askuser', denyingAskUser(cwd, armedTranscript())))).toBe('allow');
  });

  it('config present + SUPERPOWERS_ROUTING_GUARD=0: allows', () => {
    const cwd = makeProject(ROUTING);
    const guard = { SUPERPOWERS_ROUTING_GUARD: '0' };
    expect(decision(run('taskcreate', denyingTaskCreate(cwd), guard))).toBe('allow');
    expect(decision(run('agent', denyingAgent(cwd, mechanicalInProgressTranscript()), guard))).toBe('allow');
    expect(decision(run('askuser', denyingAskUser(cwd, armedTranscript()), guard))).toBe('allow');
  });

  it('malformed config JSON: allows (fail open)', () => {
    const cwd = makeProject('{ not json !!');
    expect(decision(run('taskcreate', denyingTaskCreate(cwd)))).toBe('allow');
    expect(decision(run('agent', denyingAgent(cwd, mechanicalInProgressTranscript())))).toBe('allow');
    expect(decision(run('askuser', denyingAskUser(cwd, armedTranscript())))).toBe('allow');
  });

  it('fails open to {} on invalid stdin', () => {
    for (const hook of Object.keys(HOOKS)) {
      const out = execFileSync('node', [HOOKS[hook]], {
        input: 'not json',
        encoding: 'utf8',
        env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome },
      });
      expect(out.trim()).toBe('{}');
    }
  });
});

describe('loadRouting profile-scoped candidate', () => {
  it('uses the CLAUDE_CONFIG_DIR profile file when no project file exists', () => {
    const cwd = makeProject(undefined);
    const profileDir = makeProfile(ROUTING);
    const result = loadRoutingProbe(cwd, { CLAUDE_CONFIG_DIR: profileDir });
    expect(result.routing).toEqual(ROUTING);
    expect(result.source).toBe(path.join(profileDir, 'superpowers', 'model-routing.json'));
  });

  it('project file still beats the profile file', () => {
    const projectRouting = { mechanical: 'haiku', standard: 'sonnet', frontier: 'opus' };
    const cwd = makeProject(projectRouting);
    const profileDir = makeProfile(ROUTING);
    const result = loadRoutingProbe(cwd, { CLAUDE_CONFIG_DIR: profileDir });
    expect(result.routing).toEqual(projectRouting);
    expect(result.source).toBe(path.join(cwd, 'docs', 'superpowers', 'model-routing.json'));
  });

  it('unset CLAUDE_CONFIG_DIR: legacy home fallback behaves as in v7.1.0', () => {
    const cwd = makeProject(undefined);
    const legacyDir = path.join(tmpHome, '.claude', 'superpowers');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'model-routing.json'), JSON.stringify(ROUTING));
    const result = loadRoutingProbe(cwd);
    expect(result.routing).toEqual(ROUTING);
    expect(result.source).toBe(path.join(tmpHome, '.claude', 'superpowers', 'model-routing.json'));
  });

  it('appends the winning source path to hooks-logs/routing-config.log under the config dir', () => {
    const cwd = makeProject(undefined);
    const profileDir = makeProfile(ROUTING);
    loadRoutingProbe(cwd, { CLAUDE_CONFIG_DIR: profileDir });
    const logPath = path.join(profileDir, 'hooks-logs', 'routing-config.log');
    const contents = fs.readFileSync(logPath, 'utf8');
    expect(contents).toContain(`routing-config: using ${path.join(profileDir, 'superpowers', 'model-routing.json')}`);
  });
});

describe('pre-taskcreate-model-tier', () => {
  const cwd = makeProject(ROUTING);

  it('denies a plan-shaped description whose fence has no tier', () => {
    const json = run('taskcreate', denyingTaskCreate(cwd));
    expect(decision(json)).toBe('deny');
    const reason = json.hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain('mechanical');
    expect(reason).toContain('standard');
    expect(reason).toContain('frontier');
    expect(reason).toContain('spec completeness wins');
  });

  it('denies a plan-shaped subject without any metadata fence', () => {
    const json = run('taskcreate', {
      tool_name: 'TaskCreate',
      cwd,
      tool_input: { subject: 'Phase 2: wire it up', description: 'just do it' },
    });
    expect(decision(json)).toBe('deny');
  });

  it('allows modelTier mechanical', () => {
    const json = run('taskcreate', {
      tool_name: 'TaskCreate',
      cwd,
      tool_input: { subject: 'Task 1: x', description: planDescription({ modelTier: 'mechanical' }) },
    });
    expect(decision(json)).toBe('allow');
  });

  it('allows a concrete model pin without a tier', () => {
    const json = run('taskcreate', {
      tool_name: 'TaskCreate',
      cwd,
      tool_input: { subject: 'Task 1: x', description: planDescription({ model: 'opus' }) },
    });
    expect(decision(json)).toBe('allow');
  });

  it('allows a non-plan-shaped task without a fence', () => {
    const json = run('taskcreate', {
      tool_name: 'TaskCreate',
      cwd,
      tool_input: { subject: 'quick follow-up', description: 'check the logs' },
    });
    expect(decision(json)).toBe('allow');
  });

  it('denies an invalid tier value', () => {
    const json = run('taskcreate', {
      tool_name: 'TaskCreate',
      cwd,
      tool_input: { subject: 'Task 1: x', description: planDescription({ modelTier: 'turbo' }) },
    });
    expect(decision(json)).toBe('deny');
  });
});

describe('pre-agent-model-routing', () => {
  const cwd = makeProject(ROUTING);

  it('denies a dispatch model outside the allowed set, naming the set', () => {
    const json = run('agent', denyingAgent(cwd, mechanicalInProgressTranscript()));
    expect(decision(json)).toBe('deny');
    const reason = json.hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain('haiku');
    expect(reason).toContain('sonnet');
    expect(reason).toContain("Task #1 ('Task 1: mech work')");
  });

  it('allows the tier-resolved model', () => {
    const payload = denyingAgent(cwd, mechanicalInProgressTranscript());
    payload.tool_input.model = 'haiku';
    expect(decision(run('agent', payload))).toBe('allow');
  });

  it('allows the reviewer (standard) model while a mechanical task is in progress', () => {
    const payload = denyingAgent(cwd, mechanicalInProgressTranscript());
    payload.tool_input.model = 'sonnet';
    expect(decision(run('agent', payload))).toBe('allow');
  });

  it('allows an absent model param (inherit)', () => {
    const payload = denyingAgent(cwd, mechanicalInProgressTranscript());
    delete payload.tool_input.model;
    expect(decision(run('agent', payload))).toBe('allow');
  });

  it('allows any model when the in-progress tier resolves to "inherit"', () => {
    const transcript = makeTranscript([
      toolUse('TaskCreate', { subject: 'Task 1: hard design', description: planDescription({ modelTier: 'frontier' }) }, 'tu1'),
      toolResult('tu1', 'Task #1 created successfully.'),
      toolUse('TaskUpdate', { taskId: '1', status: 'in_progress' }, 'tu2'),
    ]);
    expect(decision(run('agent', denyingAgent(cwd, transcript)))).toBe('allow');
  });

  it('exempts custom subagent_types', () => {
    const payload = denyingAgent(cwd, mechanicalInProgressTranscript());
    payload.tool_input.subagent_type = 'Explore';
    expect(decision(run('agent', payload))).toBe('allow');
  });

  it('allows when the constraining task completed', () => {
    const transcript = makeTranscript([
      toolUse('TaskCreate', { subject: 'Task 1: mech work', description: planDescription({ modelTier: 'mechanical' }) }, 'tu1'),
      toolResult('tu1', 'Task #1 created successfully.'),
      toolUse('TaskUpdate', { taskId: '1', status: 'in_progress' }, 'tu2'),
      toolUse('TaskUpdate', { taskId: '1', status: 'completed' }, 'tu3'),
    ]);
    expect(decision(run('agent', denyingAgent(cwd, transcript)))).toBe('allow');
  });

  it('allows on an unreadable transcript (fail open)', () => {
    const payload = denyingAgent(cwd, path.join(tmpHome, 'does-not-exist.jsonl'));
    expect(decision(run('agent', payload))).toBe('allow');
  });

  it('regression: keys tasks by native result id, not creation order', () => {
    // Creation order: standard first, mechanical second — but the native ids
    // come back out of order (#7 for the mechanical task, #3 for the standard
    // one). Task #7 (mechanical) is in progress; #3 completed. Keying by
    // creation order would find no in-progress tier and wave "opus" through.
    const transcript = makeTranscript([
      toolUse('TaskCreate', { subject: 'Task 2: std work', description: planDescription({ modelTier: 'standard' }) }, 'tuA'),
      toolUse('TaskCreate', { subject: 'Task 1: mech work', description: planDescription({ modelTier: 'mechanical' }) }, 'tuB'),
      toolResult('tuA', 'Task #3 created successfully.'),
      toolResult('tuB', 'Task #7 created successfully.'),
      toolUse('TaskUpdate', { taskId: '3', status: 'completed' }, 'tuC'),
      toolUse('TaskUpdate', { taskId: '7', status: 'in_progress' }, 'tuD'),
    ]);
    const denied = run('agent', denyingAgent(cwd, transcript));
    expect(decision(denied)).toBe('deny');
    expect(denied.hookSpecificOutput.permissionDecisionReason).toContain('haiku');

    const payload = denyingAgent(cwd, transcript);
    payload.tool_input.model = 'haiku';
    expect(decision(run('agent', payload))).toBe('allow');
  });

  it('regression: constrains even when the result line omits "successfully"', () => {
    // The pre-filter must not couple to the harness's exact result wording;
    // CREATE_RE only needs "Task #N created".
    const transcript = makeTranscript([
      toolUse('TaskCreate', { subject: 'Task 4: mech work', description: planDescription({ modelTier: 'mechanical' }) }, 'tu1'),
      toolResult('tu1', 'Task #4 created.'),
      toolUse('TaskUpdate', { taskId: '4', status: 'in_progress' }, 'tu2'),
    ]);
    const json = run('agent', denyingAgent(cwd, transcript));
    expect(decision(json)).toBe('deny');
    expect(json.hookSpecificOutput.permissionDecisionReason).toContain('haiku');
  });
});

describe('pre-askuser-handoff-guard', () => {
  const cwd = makeProject(ROUTING);

  it('denies a non-compliant question when armed', () => {
    const json = run('askuser', denyingAskUser(cwd, armedTranscript()));
    expect(decision(json)).toBe('deny');
    const reason = json.hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain('Subagent-Driven (this session)');
    expect(reason).toContain('Parallel Session (separate)');
  });

  it('allows the compliant two-option handoff', () => {
    const payload = {
      tool_name: 'AskUserQuestion',
      cwd,
      transcript_path: armedTranscript(),
      tool_input: {
        questions: [{
          question: 'Plan complete and saved. How would you like to execute it?',
          options: [
            { label: 'Subagent-Driven (this session)' },
            { label: 'Parallel Session (separate)' },
          ],
        }],
      },
    };
    expect(decision(run('askuser', payload))).toBe('allow');
  });

  it('allows a question carrying the CLARIFICATION token', () => {
    const payload = denyingAskUser(cwd, armedTranscript());
    payload.tool_input.questions[0].question = 'CLARIFICATION: which auth provider should Task 3 target?';
    expect(decision(run('askuser', payload))).toBe('allow');
  });

  it('allows when disarmed by a later executing-plans invocation', () => {
    const transcript = armedTranscript([
      toolUse('Skill', { skill: 'superpowers:executing-plans' }, 'tu9'),
    ]);
    expect(decision(run('askuser', denyingAskUser(cwd, transcript)))).toBe('allow');
  });

  it('allows when a compliant handoff already happened', () => {
    const transcript = armedTranscript([
      toolUse('AskUserQuestion', {
        questions: [{
          question: 'Plan complete. How would you like to execute it?',
          options: [
            { label: 'Subagent-Driven (this session)' },
            { label: 'Parallel Session (separate)' },
          ],
        }],
      }, 'tu9'),
    ]);
    expect(decision(run('askuser', denyingAskUser(cwd, transcript)))).toBe('allow');
  });

  it('allows when writing-plans never ran', () => {
    const transcript = makeTranscript([
      toolUse('TaskCreate', { subject: 'Task 1: x', description: planDescription({ modelTier: 'mechanical' }) }, 'tu1'),
    ]);
    expect(decision(run('askuser', denyingAskUser(cwd, transcript)))).toBe('allow');
  });
});
