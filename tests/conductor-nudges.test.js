import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, '..', 'hooks', 'conductor-nudges.js');

// Directory that resolves `node` on the real PATH, so a sandboxed PATH keeps
// node runnable without leaking any other PATH entries (e.g. a machine-local
// `codegraph` install) into the probe. Mirrors tests/session-start-payload.test.js.
function dirOf(bin) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir && exts.some((ext) => fs.existsSync(path.join(dir, bin + ext)))) return dir;
  }
  return null;
}
const SANDBOX_PATH = [dirOf('node')].filter(Boolean).join(path.delimiter);

let home; let sid = 0; let sessionId;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(spTmpDir(), 'sp-nudge-home-'));
  sessionId = `nudge-test-${process.pid}-${sid++}`;
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(path.join(spTmpDir(), `conductor-${sessionId}`), { force: true });
  for (const cls of ['codegraph', 'codegraph-init', 'lsp', 'middleware']) {
    fs.rmSync(path.join(spTmpDir(), `conductor-${sessionId}-${cls}`), { force: true });
  }
});

function seedState(caps, spent = {}) {
  const base = {
    codegraph: false,
    'codegraph-init': false,
    lsp: { extensions: [], declined: [], declinedAll: false },
    middleware: false,
  };
  const spentBase = { codegraph: false, 'codegraph-init': false, lsp: false, middleware: false };
  fs.writeFileSync(path.join(spTmpDir(), `conductor-${sessionId}`), JSON.stringify({
    caps: { ...base, ...caps },
    spent: { ...spentBase, ...spent },
  }));
}

function run(payload, envOverride = {}) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, ...envOverride };
  // Strip the host's ambient CLAUDE_CONFIG_DIR so probe() doesn't leak the
  // real dev environment's config root into a test - but keep one an
  // envOverride sets explicitly (real-probe tests point it at a fake root).
  if (!('CLAUDE_CONFIG_DIR' in envOverride)) delete env.CLAUDE_CONFIG_DIR;
  const out = execFileSync('node', [HOOK], {
    input: JSON.stringify({ session_id: sessionId, cwd: home, ...payload }),
    encoding: 'utf8', env,
  });
  return JSON.parse(out);
}

const ctx = (out) => out?.hookSpecificOutput?.additionalContext ?? null;

describe('conductor-nudges', () => {
  it('nudges codegraph on Grep once, then goes silent', () => {
    seedState({ codegraph: true });
    const first = run({ hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: { pattern: 'x' } });
    expect(ctx(first)).toMatch(/codegraph explore/);
    const second = run({ hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: { pattern: 'y' } });
    expect(second).toEqual({});
  });

  it('nudges middleware only on large failing Bash output', () => {
    seedState({ middleware: true });
    const big = 'FAIL tests/x.test.js\n' + 'assertion detail line\n'.repeat(200);
    const small = 'FAIL quick';
    const bigPass = 'all tests passed\n' + 'ok line\n'.repeat(200);
    expect(run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: { stdout: small, stderr: '' } })).toEqual({});
    expect(run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: { stdout: bigPass, stderr: '' } })).toEqual({});
    expect(ctx(run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: { stdout: big, stderr: '' } }))).toMatch(/summarize-test-failure/);
    expect(run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: { stdout: big, stderr: '' } })).toEqual({});
  });

  it('does not nudge a class whose capability is absent', () => {
    seedState({ middleware: true }); // codegraph false
    expect(run({ hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: {} })).toEqual({});
  });

  it('creates a state file on first run with no capabilities in an empty home', () => {
    // PATH sandboxed like the other real-probe tests below: an unrestricted
    // PATH would leak a host-installed `codegraph` binary into the probe and
    // fire the codegraph-init offer, which this test is not about.
    expect(run(
      { hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: {} },
      { PATH: SANDBOX_PATH }
    )).toEqual({});
    expect(fs.existsSync(path.join(spTmpDir(), `conductor-${sessionId}`))).toBe(true);
  });

  it('fails open on malformed stdin', () => {
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    const out = execFileSync('node', [HOOK], { input: 'not json', encoding: 'utf8', env });
    expect(JSON.parse(out)).toEqual({});
  });

  it('gates the codegraph nudge on capability status, not an indexed dir alone', () => {
    fs.mkdirSync(path.join(home, '.codegraph'));
    const out = run(
      { hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: { pattern: 'x' } },
      { PATH: SANDBOX_PATH }
    );
    expect(out).toEqual({});
    const state = JSON.parse(fs.readFileSync(path.join(spTmpDir(), `conductor-${sessionId}`), 'utf8'));
    expect(state.caps.codegraph).toBe(false);
  });

  it('emits exactly one nudge across 5 concurrent first-turn invocations', async () => {
    seedState({ codegraph: true });
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    delete env.CLAUDE_CONFIG_DIR;
    const payload = JSON.stringify({
      session_id: sessionId, cwd: home,
      hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: { pattern: 'x' },
    });
    // execFile's (async) options do not support `input` the way the Sync
    // variants do - the child's stdin must be written and closed by hand,
    // or the hook's `for await (const chunk of process.stdin)` blocks forever.
    const runs = await Promise.all(
      Array.from({ length: 5 }, () => {
        const p = execFileAsync('node', [HOOK], { encoding: 'utf8', env });
        p.child.stdin.end(payload);
        return p;
      })
    );
    const outs = runs.map((r) => JSON.parse(r.stdout));
    const withCtx = outs.filter((o) => ctx(o));
    expect(withCtx.length).toBe(1);
    expect(ctx(withCtx[0])).toMatch(/codegraph explore/);
  }, 10000);

  it('offers codegraph init on an unindexed repo, once', () => {
    seedState({ 'codegraph-init': true });
    const first = run({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'a.md' } });
    expect(ctx(first)).toMatch(/codegraph init/);
    expect(ctx(first)).toMatch(/natural break/);
    expect(run({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} })).toEqual({});
  });

  it('prefers the codegraph tip over the init offer when the repo is indexed', () => {
    seedState({ codegraph: true });
    expect(ctx(run({ hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: {} }))).toMatch(/codegraph explore/);
  });

  it('offers codegraph init through the real probe on an unindexed repo', () => {
    // No seedState: this drives probe() for real, which the existing positive
    // nudge tests never do. A probe field rename would silently zero every
    // nudge and no other test would notice.
    const bin = path.join(home, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const exe = process.platform === 'win32' ? 'codegraph.cmd' : 'codegraph';
    fs.writeFileSync(path.join(bin, exe), '');
    const out = run(
      { hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: { pattern: 'x' } },
      { PATH: [bin, SANDBOX_PATH].join(path.delimiter) }
    );
    expect(ctx(out)).toMatch(/codegraph init/);
    const state = JSON.parse(fs.readFileSync(path.join(spTmpDir(), `conductor-${sessionId}`), 'utf8'));
    expect(state.caps['codegraph-init']).toBe(true);
    expect(state.caps.codegraph).toBe(false);
  });

  it('respects the codegraph decline marker for the init offer', () => {
    fs.writeFileSync(path.join(home, '.superpowers-no-codegraph'), '');
    const bin = path.join(home, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const exe = process.platform === 'win32' ? 'codegraph.cmd' : 'codegraph';
    fs.writeFileSync(path.join(bin, exe), '');
    const out = run(
      { hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: {} },
      { PATH: [bin, SANDBOX_PATH].join(path.delimiter) }
    );
    expect(out).toEqual({});
  });

  it('offers an LSP plugin after editing an uncovered file type', () => {
    seedState({ lsp: { extensions: [], declined: [], declinedAll: false } });
    const out = run({
      hook_event_name: 'PostToolUse', tool_name: 'Edit',
      tool_input: { file_path: 'src/index.ts' }, tool_response: {},
    });
    expect(ctx(out)).toMatch(/typescript-lsp/);
    expect(ctx(out)).toMatch(/natural break/);
  });

  it('stays silent when a language server already covers the extension', () => {
    seedState({ lsp: { extensions: ['.ts'], declined: [], declinedAll: false } });
    expect(run({
      hook_event_name: 'PostToolUse', tool_name: 'Edit',
      tool_input: { file_path: 'src/index.ts' }, tool_response: {},
    })).toEqual({});
  });

  it('stays silent for an unmapped extension', () => {
    seedState({ lsp: { extensions: [], declined: [], declinedAll: false } });
    expect(run({
      hook_event_name: 'PostToolUse', tool_name: 'Edit',
      tool_input: { file_path: 'notes.md' }, tool_response: {},
    })).toEqual({});
  });

  it('respects a per-plugin LSP decline but still offers other languages', () => {
    seedState({ lsp: { extensions: [], declined: ['typescript-lsp'], declinedAll: false } });
    expect(run({
      hook_event_name: 'PostToolUse', tool_name: 'Edit',
      tool_input: { file_path: 'src/index.ts' }, tool_response: {},
    })).toEqual({});
    expect(ctx(run({
      hook_event_name: 'PostToolUse', tool_name: 'Edit',
      tool_input: { file_path: 'app/main.py' }, tool_response: {},
    }))).toMatch(/pyright-lsp/);
  });

  // Mirrors installLspPlugin in tests/capability-registry.test.js: builds the
  // installed_plugins.json + install-dir .lsp.json tree probe()'s lspExtensions()
  // actually reads.
  function installLspPlugin(prof, name, file, body) {
    const inst = path.join(prof, 'plugins', 'cache', 'm', name, '1.0.0');
    fs.mkdirSync(inst, { recursive: true });
    fs.writeFileSync(path.join(inst, file), typeof body === 'string' ? body : JSON.stringify(body));
    fs.mkdirSync(path.join(prof, 'plugins'), { recursive: true });
    const idxPath = path.join(prof, 'plugins', 'installed_plugins.json');
    const idx = fs.existsSync(idxPath)
      ? JSON.parse(fs.readFileSync(idxPath, 'utf8'))
      : { version: 1, plugins: {} };
    idx.plugins[`${name}@m`] = [{ installPath: inst }];
    fs.writeFileSync(idxPath, JSON.stringify(idx));
    return inst;
  }

  it('offers an LSP plugin through the real probe, with extensions read from an installed server', () => {
    // No seedState: this drives probe() for real, mirroring the codegraph-init
    // real-probe test above. This proves probe().lsp.extensions is read
    // correctly; a rename of that field would fail here. It does NOT cover
    // probe().lsp.declined or .declinedAll — those are only exercised via
    // seedState() elsewhere in this file, so a rename of just those two
    // sub-fields would default permissively and stay green.
    const prof = path.join(home, 'prof');
    // Covers .go - a different extension than the one edited below - so a
    // non-empty extensions array from the real probe is what lets the
    // typescript-lsp offer through, not an empty/defaulted one.
    installLspPlugin(prof, 'gopls-lsp', '.lsp.json', {
      go: { command: 'gopls', extensionToLanguage: { '.go': 'go' } },
    });
    const out = run(
      {
        hook_event_name: 'PostToolUse', tool_name: 'Edit',
        tool_input: { file_path: 'src/index.ts' }, tool_response: {},
      },
      { PATH: SANDBOX_PATH, CLAUDE_CONFIG_DIR: prof }
    );
    expect(ctx(out)).toMatch(/typescript-lsp/);
    const state = JSON.parse(fs.readFileSync(path.join(spTmpDir(), `conductor-${sessionId}`), 'utf8'));
    expect(state.caps.lsp.extensions).toContain('.go');
  });

  it('never mentions serena', () => {
    seedState({
      codegraph: true, 'codegraph-init': false, middleware: true,
      lsp: { extensions: [], declined: [], declinedAll: false },
    });
    const codegraphOut = run({ hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: {} });
    const lspOut = run({
      hook_event_name: 'PostToolUse', tool_name: 'Edit',
      tool_input: { file_path: 'src/index.ts' }, tool_response: {},
    });
    const middlewareOut = run({
      hook_event_name: 'PostToolUse', tool_name: 'Bash',
      tool_response: { stdout: 'FAIL tests/x.test.js\n' + 'assertion detail line\n'.repeat(200), stderr: '' },
    });
    // codegraph and codegraph-init share one dispatch branch that always
    // prefers codegraph-init when both caps are true, so reaching the
    // codegraph-init tip needs a second, separate seeded state.
    seedState({ 'codegraph-init': true });
    const codegraphInitOut = run({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} });

    // Confirm each call actually fired its tip - a silently empty {} would
    // make the serena check below meaningless.
    expect(ctx(codegraphOut)).toMatch(/codegraph explore/);
    expect(ctx(lspOut)).toMatch(/typescript-lsp/);
    expect(ctx(middlewareOut)).toMatch(/summarize-test-failure/);
    expect(ctx(codegraphInitOut)).toMatch(/codegraph init/);

    for (const o of [codegraphOut, lspOut, middlewareOut, codegraphInitOut]) {
      expect(JSON.stringify(o)).not.toMatch(/serena/i);
    }
  });
});
