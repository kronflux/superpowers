import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { loadRouting, normalizeRouting, TIERS, REQUIRED_TIERS } from '../hooks/lib/routing-config.js';
import { checkDispatch, scanTranscript } from '../hooks/pre-agent-model-routing.js';
import { checkTaskCreate } from '../hooks/pre-taskcreate-model-tier.js';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';
import { markerPath } from '../hooks/lib/rejection-dedup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOKS = {
  taskcreate: path.join(__dirname, '..', 'hooks', 'pre-taskcreate-model-tier.js'),
  agent: path.join(__dirname, '..', 'hooks', 'pre-agent-model-routing.js'),
  askuser: path.join(__dirname, '..', 'hooks', 'pre-askuser-handoff-guard.js'),
};

// Isolated home: the ~/.claude/superpowers fallback must never see a real
// user config, and hook telemetry must never touch real ~/.claude/hooks-logs.
const tmpHome = fs.mkdtempSync(path.join(spTmpDir(), 'sp-routing-home-'));
const tmpDirs = [tmpHome];
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

const ROUTING = { mechanical: 'haiku', standard: 'sonnet', frontier: 'inherit' };
// ROUTING is the legacy three-key shape; loadRouting normalizes it (the old
// "frontier" becomes "advanced", the new "frontier" tier disables to "off")
// before returning it, so behavior assertions compare against this shape.
const NORMALIZED_ROUTING = { mechanical: 'haiku', standard: 'sonnet', advanced: 'inherit', frontier: 'off', schema: 1 };

function makeProject(config, { legacy = false } = {}) {
  const dir = fs.mkdtempSync(path.join(spTmpDir(), 'sp-routing-proj-'));
  tmpDirs.push(dir);
  if (config !== undefined) {
    const cfgDir = legacy ? path.join(dir, 'docs', 'superpowers') : path.join(dir, '.superpowers');
    fs.mkdirSync(cfgDir, { recursive: true });
    const body = typeof config === 'string' ? config : JSON.stringify(config);
    fs.writeFileSync(path.join(cfgDir, 'model-routing.json'), body);
  }
  return dir;
}

function makeProfile(config) {
  const dir = fs.mkdtempSync(path.join(spTmpDir(), 'sp-routing-profile-'));
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

// Sequence probe: two loadRouting calls in the SAME process, to check that
// routingSource() reflects only the most recent call (no stale carry-over).
const probeSequenceScript = path.join(tmpHome, 'load-routing-probe-sequence.mjs');
fs.writeFileSync(
  probeSequenceScript,
  `import { loadRouting, routingSource } from '${routingLibUrl}';\n` +
    'const results = process.argv.slice(2).map((cwd) => {\n' +
    '  const routing = loadRouting(cwd, process.env);\n' +
    '  return { routing, source: routingSource() };\n' +
    '});\n' +
    'process.stdout.write(JSON.stringify(results));\n'
);

function loadRoutingSequenceProbe(cwds, envOverrides = {}) {
  const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
  delete env.SUPERPOWERS_ROUTING_GUARD;
  delete env.CLAUDE_CONFIG_DIR;
  Object.assign(env, envOverrides);
  const out = execFileSync('node', [probeSequenceScript, ...cwds], { encoding: 'utf8', env });
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
    expect(result.routing).toEqual(NORMALIZED_ROUTING);
    expect(result.source).toBe(path.join(profileDir, 'superpowers', 'model-routing.json'));
  });

  it('project file still beats the profile file', () => {
    const projectRouting = { mechanical: 'haiku', standard: 'sonnet', frontier: 'opus' };
    const cwd = makeProject(projectRouting);
    const profileDir = makeProfile(ROUTING);
    const result = loadRoutingProbe(cwd, { CLAUDE_CONFIG_DIR: profileDir });
    expect(result.routing).toEqual({
      mechanical: 'haiku', standard: 'sonnet', advanced: 'opus', frontier: 'off', schema: 1,
    });
    expect(result.source).toBe(path.join(cwd, '.superpowers', 'model-routing.json'));
  });

  it('unset CLAUDE_CONFIG_DIR: legacy home fallback behaves as in v7.1.0', () => {
    const cwd = makeProject(undefined);
    const legacyDir = path.join(tmpHome, '.claude', 'superpowers');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'model-routing.json'), JSON.stringify(ROUTING));
    const result = loadRoutingProbe(cwd);
    expect(result.routing).toEqual(NORMALIZED_ROUTING);
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

  it('routingSource() reflects only the most recent call, not a stale prior hit', () => {
    const hitCwd = makeProject(ROUTING);
    const missCwd = makeProject(undefined);
    // Empty, dedicated HOME and CLAUDE_CONFIG_DIR for both calls: no legacy
    // or profile candidate exists anywhere, so the second call is a true miss.
    const emptyHome = fs.mkdtempSync(path.join(spTmpDir(), 'sp-routing-stale-home-'));
    tmpDirs.push(emptyHome);
    const emptyProfile = fs.mkdtempSync(path.join(spTmpDir(), 'sp-routing-stale-profile-'));
    tmpDirs.push(emptyProfile);
    const [hit, miss] = loadRoutingSequenceProbe([hitCwd, missCwd], {
      HOME: emptyHome,
      USERPROFILE: emptyHome,
      CLAUDE_CONFIG_DIR: emptyProfile,
    });
    expect(hit.routing).toEqual(NORMALIZED_ROUTING);
    expect(hit.source).toBe(path.join(hitCwd, '.superpowers', 'model-routing.json'));
    expect(miss.routing).toBeNull();
    expect(miss.source).toBeNull();
  });
});

describe('project candidate chain (.superpowers canonical, docs/superpowers legacy)', () => {
  it('canonical .superpowers/ wins over legacy docs/superpowers/', () => {
    const dir = makeProject({ ...ROUTING, mechanical: 'canonical-model' });
    fs.mkdirSync(path.join(dir, 'docs', 'superpowers'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'superpowers', 'model-routing.json'),
      JSON.stringify({ ...ROUTING, mechanical: 'legacy-model' }));
    const { routing, source } = loadRoutingProbe(dir);
    expect(routing.mechanical).toBe('canonical-model');
    expect(source).toBe(path.join(dir, '.superpowers', 'model-routing.json'));
    const log = fs.readFileSync(path.join(tmpHome, '.claude', 'hooks-logs', 'routing-config.log'), 'utf8');
    expect(log).toMatch(/both .* exist/);
  });

  it('legacy docs/superpowers/ alone still activates, with a migration log line', () => {
    const dir = makeProject(ROUTING, { legacy: true });
    const { routing, source } = loadRoutingProbe(dir);
    expect(routing).toEqual(NORMALIZED_ROUTING);
    expect(source).toBe(path.join(dir, 'docs', 'superpowers', 'model-routing.json'));
    const log = fs.readFileSync(path.join(tmpHome, '.claude', 'hooks-logs', 'routing-config.log'), 'utf8');
    expect(log).toMatch(/legacy project path in use/);
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
    // Under ROUTING (legacy shape), the old "frontier" value now normalizes
    // into "advanced" (see normalizeRouting); "advanced" is the tier that
    // resolves to "inherit" here, not "frontier" (which normalizes to "off").
    const transcript = makeTranscript([
      toolUse('TaskCreate', { subject: 'Task 1: hard design', description: planDescription({ modelTier: 'advanced' }) }, 'tu1'),
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

describe('normalizeRouting', () => {
  it('exposes four tiers and three required', () => {
    expect(TIERS).toEqual(['mechanical', 'standard', 'advanced', 'frontier']);
    expect(REQUIRED_TIERS).toEqual(['mechanical', 'standard', 'advanced']);
  });

  it('normalizes the legacy three-key shape, disabling frontier', () => {
    const { routing, reason } = normalizeRouting({
      mechanical: 'haiku', standard: 'sonnet', frontier: 'inherit',
    });
    expect(reason).toBeNull();
    expect(routing).toEqual({
      mechanical: 'haiku', standard: 'sonnet', advanced: 'inherit', frontier: 'off', schema: 1,
    });
  });

  it('passes through an explicit schema-2 config', () => {
    const raw = {
      schema: 2, mechanical: 'haiku', standard: 'sonnet', advanced: 'opus', frontier: 'fable',
    };
    const { routing } = normalizeRouting(raw);
    expect(routing.advanced).toBe('opus');
    expect(routing.frontier).toBe('fable');
  });

  it('treats a config with advanced but no schema key as new-schema', () => {
    const { routing } = normalizeRouting({
      mechanical: 'haiku', standard: 'sonnet', advanced: 'opus',
    });
    expect(routing.advanced).toBe('opus');
    expect(routing.frontier).toBe('off');
  });

  it('rejects a legacy config that maps frontier to a fable model', () => {
    const { routing, reason } = normalizeRouting({
      mechanical: 'haiku', standard: 'sonnet', frontier: 'claude-fable-5',
    });
    expect(routing).toBeNull();
    expect(reason).toMatch(/fable/i);
  });

  it('rejects a config missing a required tier', () => {
    const { routing } = normalizeRouting({ mechanical: 'haiku', standard: 'sonnet' });
    expect(routing).toBeNull();
  });

  it('rejects an enabled frontier that duplicates the advanced model', () => {
    const { routing, reason } = normalizeRouting({
      schema: 2, mechanical: 'haiku', standard: 'sonnet', advanced: 'fable', frontier: 'fable',
    });
    expect(routing).toBeNull();
    expect(reason).toMatch(/distinct|same/i);
  });
});

describe('loadRouting normalization end-to-end', () => {
  it('normalizes a legacy on-disk config to the four-key shape (criterion 1)', () => {
    const tmp = fs.mkdtempSync(path.join(spTmpDir(), 'sp-routing-normalize-'));
    tmpDirs.push(tmp);
    const cfgDir = path.join(tmp, 'docs', 'superpowers');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      path.join(cfgDir, 'model-routing.json'),
      JSON.stringify({ mechanical: 'haiku', standard: 'sonnet', frontier: 'inherit' })
    );
    const routing = loadRouting(tmp, { CLAUDE_CONFIG_DIR: tmp, HOME: tmp });
    expect(routing).toEqual({
      mechanical: 'haiku', standard: 'sonnet', advanced: 'inherit', frontier: 'off', schema: 1,
    });
  });

  it('rejects a legacy fable-mapped config on disk and logs the rejection (criterion 4)', () => {
    const tmp = fs.mkdtempSync(path.join(spTmpDir(), 'sp-routing-normalize-reject-'));
    tmpDirs.push(tmp);
    const cfgDir = path.join(tmp, 'docs', 'superpowers');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      path.join(cfgDir, 'model-routing.json'),
      JSON.stringify({ mechanical: 'haiku', standard: 'sonnet', frontier: 'claude-fable-5' })
    );
    const routing = loadRouting(tmp, { CLAUDE_CONFIG_DIR: tmp, HOME: tmp });
    expect(routing).toBeNull();
    const logPath = path.join(tmp, 'hooks-logs', 'routing-config.log');
    const contents = fs.readFileSync(logPath, 'utf8');
    expect(contents).toContain('rejected');
  });
});

const R4 = { mechanical: 'haiku', standard: 'sonnet', advanced: 'opus', frontier: 'fable' };
const fenced4 = (meta) => ({
  subject: 'Task 9', description: '```json:metadata\n' + JSON.stringify(meta) + '\n```',
});

describe('frontier consent gate', () => {
  it('denies a frontier dispatch with no consent anywhere', () => {
    const tasks = new Map([['9', fenced4({ modelTier: 'frontier' })]]);
    const r = checkDispatch(R4, tasks, ['9'], 'fable', new Set());
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/approval/i);
  });

  it('denies when the fence token has no transcript corroboration', () => {
    const tasks = new Map([['9', fenced4({
      modelTier: 'frontier', frontierConsent: 'FRONTIER-APPROVED:task-9',
    })]]);
    expect(checkDispatch(R4, tasks, ['9'], 'fable', new Set()).blocked).toBe(true);
  });

  it('allows when fence token and transcript token match', () => {
    const tasks = new Map([['9', fenced4({
      modelTier: 'frontier', frontierConsent: 'FRONTIER-APPROVED:task-9',
    })]]);
    const tokens = new Set(['FRONTIER-APPROVED:task-9']);
    expect(checkDispatch(R4, tasks, ['9'], 'fable', tokens).blocked).toBe(false);
  });

  it('denies when the tokens name different tasks', () => {
    const tasks = new Map([['9', fenced4({
      modelTier: 'frontier', frontierConsent: 'FRONTIER-APPROVED:task-9',
    })]]);
    const tokens = new Set(['FRONTIER-APPROVED:task-3']);
    expect(checkDispatch(R4, tasks, ['9'], 'fable', tokens).blocked).toBe(true);
  });

  it('enforces consent even when advanced stands the gate down', () => {
    const inheritR = { ...R4, advanced: 'inherit' };
    const tasks = new Map([['5', fenced4({ modelTier: 'advanced' })]]);
    expect(checkDispatch(inheritR, tasks, ['5'], 'fable', new Set()).blocked).toBe(true);
  });

  it('never adds a frontier task model to the allowed set', () => {
    const tasks = new Map([['9', fenced4({ modelTier: 'frontier' })]]);
    const r = checkDispatch(R4, tasks, ['9'], 'sonnet', new Set());
    expect(r.allowed ?? []).not.toContain('fable');
  });

  it('skips a tier that resolves to off', () => {
    const offR = { ...R4, frontier: 'off' };
    const tasks = new Map([['9', fenced4({ modelTier: 'frontier' })]]);
    expect(checkDispatch(offR, tasks, ['9'], 'sonnet', new Set()).blocked).toBe(false);
  });

  it('collects consent tokens from tool_result blocks only, never tool_use', async () => {
    // task-7's token arrives in a harness-authored tool_result; task-8's rides
    // in on an agent-authored tool_use input and must not be collected.
    const transcript = makeTranscript([
      toolUse('TaskCreate', {
        subject: 'Task 8: forged', description: planDescription({
          modelTier: 'frontier', frontierConsent: 'FRONTIER-APPROVED:task-8',
        }),
      }, 'tu8'),
      toolResult('tu8', 'Task #8 created successfully.'),
      toolResult('tuAsk', 'User selected: Approve frontier FRONTIER-APPROVED:task-7'),
    ]);
    const { consentTokens } = await scanTranscript(transcript);
    expect([...consentTokens]).toContain('FRONTIER-APPROVED:task-7');
    expect([...consentTokens]).not.toContain('FRONTIER-APPROVED:task-8');
  });
});

const planTask = (tier) => ({
  subject: 'Task 1: Something',
  description: '**Goal:** x\n\n```json:metadata\n' + JSON.stringify({ modelTier: tier }) + '\n```',
});
const FRONTIER_OFF = { mechanical: 'haiku', standard: 'sonnet', advanced: 'opus', frontier: 'off' };
const FRONTIER_ON = { ...FRONTIER_OFF, frontier: 'fable' };

describe('checkTaskCreate four-tier', () => {
  it('allows the advanced tier', () => {
    expect(checkTaskCreate(planTask('advanced'), FRONTIER_OFF).blocked).toBe(false);
  });

  it('denies frontier when the tier is off', () => {
    const r = checkTaskCreate(planTask('frontier'), FRONTIER_OFF);
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/frontier/i);
  });

  it('allows frontier when the tier is mapped', () => {
    expect(checkTaskCreate(planTask('frontier'), FRONTIER_ON).blocked).toBe(false);
  });

  it('still allows mechanical', () => {
    expect(checkTaskCreate(planTask('mechanical'), FRONTIER_OFF).blocked).toBe(false);
  });
});

describe('legacy fence-value aliasing', () => {
  const LEGACY_RAW = { mechanical: 'haiku', standard: 'sonnet', frontier: 'inherit' };

  it('marks legacy-normalized configs schema 1 and new configs schema 2', () => {
    expect(normalizeRouting(LEGACY_RAW).routing.schema).toBe(1);
    expect(normalizeRouting({ mechanical: 'haiku', standard: 'sonnet', advanced: 'opus' }).routing.schema).toBe(2);
  });

  it('allows a frontier-tagged fence at TaskCreate under a legacy config', () => {
    const legacy = normalizeRouting(LEGACY_RAW).routing;
    const task = {
      subject: 'Task 1: Something',
      description: '**Goal:** x\n\n```json:metadata\n{"modelTier":"frontier"}\n```',
    };
    expect(checkTaskCreate(task, legacy).blocked).toBe(false);
  });

  it('still rejects a frontier fence under an explicit schema-2 config with frontier off', () => {
    const explicit = { schema: 2, mechanical: 'haiku', standard: 'sonnet', advanced: 'opus', frontier: 'off' };
    const task = {
      subject: 'Task 1: Something',
      description: '**Goal:** x\n\n```json:metadata\n{"modelTier":"frontier"}\n```',
    };
    expect(checkTaskCreate(task, explicit).blocked).toBe(true);
  });

  it('dispatch: legacy frontier fence resolves as advanced (inherit stands the gate down)', () => {
    const legacy = normalizeRouting(LEGACY_RAW).routing; // advanced: 'inherit'
    const tasks = new Map([['9', {
      subject: 'Task 9', description: '```json:metadata\n{"modelTier":"frontier"}\n```',
    }]]);
    expect(checkDispatch(legacy, tasks, ['9'], 'anything', new Set()).blocked).toBe(false);
  });

  it('dispatch: legacy frontier fence with a concrete advanced model joins the allowed set', () => {
    const legacy = normalizeRouting({ mechanical: 'haiku', standard: 'sonnet', frontier: 'opus' }).routing; // advanced: 'opus'
    const tasks = new Map([['9', {
      subject: 'Task 9', description: '```json:metadata\n{"modelTier":"frontier"}\n```',
    }]]);
    const ok = checkDispatch(legacy, tasks, ['9'], 'opus', new Set());
    expect(ok.blocked).toBe(false);
    const blocked = checkDispatch(legacy, tasks, ['9'], 'haiku', new Set());
    expect(blocked.blocked).toBe(true); // pre-7.3 behavior: constrained to opus (plus standard sonnet)
  });

  it('dispatch: schema-2 config still never admits the frontier tier to the allowed set', () => {
    const explicit = { schema: 2, mechanical: 'haiku', standard: 'sonnet', advanced: 'opus', frontier: 'fable' };
    const tasks = new Map([['9', {
      subject: 'Task 9', description: '```json:metadata\n{"modelTier":"frontier"}\n```',
    }]]);
    const r = checkDispatch(explicit, tasks, ['9'], 'sonnet', new Set());
    expect((r.allowed ?? [])).not.toContain('fable');
  });
});

describe('scanTranscript chronology', () => {
  function writeTranscript(lines) {
    const p = path.join(tmpHome, `transcript-${Math.random().toString(36).slice(2)}.jsonl`);
    fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    return p;
  }
  const use = (name, id, input) => ({ message: { content: [{ type: 'tool_use', id, name, input }] } });
  const result = (toolUseId, text) => ({ message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: text }] } });

  it('a later TaskCreate description beats an earlier TaskUpdate description (reused id)', async () => {
    const p = writeTranscript([
      use('TaskUpdate', 'u1', { taskId: '1', description: 'STALE from a prior task list' }),
      use('TaskCreate', 'c1', { subject: 'fresh', description: 'FRESH with fence' }),
      result('c1', 'Task #1 created successfully'),
    ]);
    const { tasks } = await scanTranscript(p);
    expect(tasks.get('1').description).toBe('FRESH with fence');
  });

  it('a later TaskUpdate description still beats the create description', async () => {
    const p = writeTranscript([
      use('TaskCreate', 'c1', { subject: 's', description: 'original' }),
      result('c1', 'Task #1 created successfully'),
      use('TaskUpdate', 'u1', { taskId: '1', description: 'updated' }),
    ]);
    const { tasks } = await scanTranscript(p);
    expect(tasks.get('1').description).toBe('updated');
  });

  it('an update without any bound create still yields a table entry', async () => {
    const p = writeTranscript([
      use('TaskUpdate', 'u1', { taskId: '9', description: 'orphan update' }),
    ]);
    const { tasks } = await scanTranscript(p);
    expect(tasks.get('9').description).toBe('orphan update');
  });
});

describe('routing-dispatch.log', () => {
  const logPath = () => path.join(tmpHome, '.claude', 'hooks-logs', 'routing-dispatch.log');
  const readLog = () => (fs.existsSync(logPath()) ? fs.readFileSync(logPath(), 'utf8') : '');

  it('records ALLOW for a permitted dispatch and BLOCK for a denied one', () => {
    const dir = makeProject(ROUTING);
    const transcript = mechanicalInProgressTranscript();
    const before = readLog();

    run('agent', {
      tool_name: 'Agent',
      cwd: dir,
      transcript_path: transcript,
      tool_input: { description: 'impl', prompt: 'do it', model: 'haiku' },
    });
    run('agent', denyingAgent(dir, transcript));

    const added = readLog().slice(before.length);
    expect(added).toMatch(/ALLOW session=- model=haiku allowed=haiku,sonnet tasks=1/);
    expect(added).toMatch(/BLOCK session=- model=opus allowed=haiku,sonnet tasks=1/);
  });

  it('logs allowed=- and tasks=- when dispatch is routed but no tasks are in-progress', () => {
    const dir = makeProject(ROUTING);
    // Transcript with TaskCreate whose result binds a native id, but no TaskUpdate to set in_progress
    const transcript = makeTranscript([
      toolUse('TaskCreate', { subject: 'Task 1: something', description: 'plain task' }, 'tu1'),
      toolResult('tu1', 'Task #1 created successfully.'),
    ]);
    const before = readLog();

    run('agent', {
      tool_name: 'Agent',
      cwd: dir,
      transcript_path: transcript,
      tool_input: { description: 'impl', prompt: 'do it', model: 'haiku' },
    });

    const added = readLog().slice(before.length);
    expect(added).toMatch(/ALLOW session=- model=haiku allowed=- tasks=-/);
  });

  it('stamps the dispatch record with the session id', () => {
    // Without this, a second Claude Code window's dispatch is indistinguishable
    // from this one's — both append to the same config-root-wide log, so the
    // statusline would confidently show the other window's activity.
    const cfgRoot = fs.mkdtempSync(path.join(spTmpDir(), 'mr-sid-'));
    const dir = makeProject(ROUTING);
    const transcript = mechanicalInProgressTranscript();
    try {
      run('agent', {
        session_id: 'sid-under-test',
        tool_name: 'Agent',
        cwd: dir,
        transcript_path: transcript,
        tool_input: { description: 'impl', prompt: 'do it', model: 'haiku' },
      }, { CLAUDE_CONFIG_DIR: cfgRoot });
      const log = fs.readFileSync(
        path.join(cfgRoot, 'hooks-logs', 'routing-dispatch.log'), 'utf8');
      expect(log).toMatch(/\bsession=sid-under-test\b/);
      // The pre-existing fields must survive unchanged — other readers parse them.
      expect(log).toMatch(/\b(ALLOW|BLOCK)\b/);
      expect(log).toMatch(/\bmodel=/);
      expect(log).toMatch(/\ballowed=/);
      expect(log).toMatch(/\btasks=/);
    } finally {
      fs.rmSync(cfgRoot, { recursive: true, force: true });
    }
  });

  it('writes nothing when routing is dormant', () => {
    // CRITICAL: tmpHome is shared across the entire test suite. The earlier describe
    // block "loadRouting profile-scoped candidate" writes a legacy routing config to
    // tmpHome/.claude/superpowers/model-routing.json. This test must delete it to
    // ensure the "dormant" scenario is actually dormant (no config found anywhere).
    // This test must run AFTER the describe blocks that populate tmpHome, or the
    // cleanup will have no effect. If a new describe block is added AFTER this one,
    // it will silently reactivate routing unless it also cleans up first.
    const legacyDir = path.join(tmpHome, '.claude', 'superpowers');
    if (fs.existsSync(legacyDir)) {
      fs.rmSync(legacyDir, { recursive: true, force: true });
    }

    const dir = makeProject();               // no config file -> routing dormant
    const transcript = mechanicalInProgressTranscript();
    const before = readLog();

    run('agent', {
      tool_name: 'Agent',
      cwd: dir,
      transcript_path: transcript,
      tool_input: { description: 'impl', prompt: 'do it', model: 'haiku' },
    });

    expect(readLog().slice(before.length)).toBe('');
  });
});

describe('dedupeReason wiring at the routing hooks', () => {
  it('pre-taskcreate-model-tier: full reason once per session, single line naming the subject after', () => {
    const cwd = makeProject(ROUTING);
    const sessionId = `dd-tc-${process.pid}-${Math.random().toString(36).slice(2)}`;
    const marker = markerPath(sessionId, 'taskcreate', 'missing-tier');
    try {
      const first = run('taskcreate', { ...denyingTaskCreate(cwd), session_id: sessionId });
      const reason1 = first.hookSpecificOutput.permissionDecisionReason;
      expect(reason1.split('\n').length).toBeGreaterThan(1);

      const payload2 = denyingTaskCreate(cwd);
      payload2.tool_input.subject = 'Task 2: build the other widget';
      const second = run('taskcreate', { ...payload2, session_id: sessionId });
      const reason2 = second.hookSpecificOutput.permissionDecisionReason;
      expect(reason2.split('\n')).toHaveLength(1);
      expect(reason2).toContain('missing-tier');
      expect(reason2).toContain('Task 2: build the other widget');
    } finally {
      fs.rmSync(marker, { force: true });
    }
  });

  it('pre-agent-model-routing: full reason once per session, single line naming the subject after', () => {
    const cwd = makeProject(ROUTING);
    const sessionId = `dd-ag-${process.pid}-${Math.random().toString(36).slice(2)}`;
    const marker = markerPath(sessionId, 'agent-routing', 'tier-mismatch');
    try {
      const transcript = mechanicalInProgressTranscript();
      const first = run('agent', { ...denyingAgent(cwd, transcript), session_id: sessionId });
      const reason1 = first.hookSpecificOutput.permissionDecisionReason;
      expect(reason1.split('\n').length).toBeGreaterThan(1);

      const payload2 = denyingAgent(cwd, transcript);
      payload2.tool_input.description = 'second impl attempt';
      const second = run('agent', { ...payload2, session_id: sessionId });
      const reason2 = second.hookSpecificOutput.permissionDecisionReason;
      expect(reason2.split('\n')).toHaveLength(1);
      expect(reason2).toContain('tier-mismatch');
      expect(reason2).toContain('second impl attempt');
    } finally {
      fs.rmSync(marker, { force: true });
    }
  });

  it('pre-askuser-handoff-guard: full reason once per session, single line naming the subject after', () => {
    const cwd = makeProject(ROUTING);
    const sessionId = `dd-au-${process.pid}-${Math.random().toString(36).slice(2)}`;
    const marker = markerPath(sessionId, 'askuser-guard', 'handoff-violation');
    try {
      const transcript = armedTranscript();
      const first = run('askuser', { ...denyingAskUser(cwd, transcript), session_id: sessionId });
      const reason1 = first.hookSpecificOutput.permissionDecisionReason;
      expect(reason1.split('\n').length).toBeGreaterThan(1);

      const payload2 = denyingAskUser(cwd, transcript);
      payload2.tool_input.questions[0].question = 'Which phase second time around?';
      const second = run('askuser', { ...payload2, session_id: sessionId });
      const reason2 = second.hookSpecificOutput.permissionDecisionReason;
      expect(reason2.split('\n')).toHaveLength(1);
      expect(reason2).toContain('handoff-violation');
      expect(reason2).toContain('Which phase second time around?');
    } finally {
      fs.rmSync(marker, { force: true });
    }
  });
});
