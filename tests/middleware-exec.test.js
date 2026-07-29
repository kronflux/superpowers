import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveConfig, endpointFor, renderTemplate, runHttp, cliDescriptor, runCli, PRESETS } from '../scripts/middleware-exec.mjs';

const execFileAsync = promisify(execFile);

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mwexec-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('resolveConfig', () => {
  it('returns null when neither project nor home config exists', () => {
    expect(resolveConfig(tmp, tmp, { HOME: tmp })).toBeNull();
  });

  it('prefers project .claude/middleware-config.json over home', () => {
    const projectCfg = { active_provider: 'project' };
    const homeCfg = { active_provider: 'home' };
    fs.mkdirSync(path.join(tmp, 'project', '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'project', '.claude', 'middleware-config.json'), JSON.stringify(projectCfg));
    fs.mkdirSync(path.join(tmp, 'home', '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'home', '.claude', 'middleware-config.json'), JSON.stringify(homeCfg));
    const resolved = resolveConfig(path.join(tmp, 'project'), path.join(tmp, 'home'), { HOME: path.join(tmp, 'home') });
    expect(resolved.cfg.active_provider).toBe('project');
  });

  it('falls back to home config when project config is absent', () => {
    const homeCfg = { active_provider: 'home' };
    fs.mkdirSync(path.join(tmp, 'project'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'home', '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'home', '.claude', 'middleware-config.json'), JSON.stringify(homeCfg));
    const resolved = resolveConfig(path.join(tmp, 'project'), path.join(tmp, 'home'), { HOME: path.join(tmp, 'home') });
    expect(resolved.cfg.active_provider).toBe('home');
    expect(resolved.source).toBe(path.join(tmp, 'home', '.claude', 'middleware-config.json'));
  });

  it('prefers profile config (CLAUDE_CONFIG_DIR) over home config', () => {
    const profileCfg = { active_provider: 'profile' };
    const homeCfg = { active_provider: 'home' };
    const profileDir = path.join(tmp, 'profile');
    fs.mkdirSync(path.join(profileDir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(profileDir, '.claude', 'middleware-config.json'), JSON.stringify(profileCfg));
    fs.mkdirSync(path.join(tmp, 'home', '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'home', '.claude', 'middleware-config.json'), JSON.stringify(homeCfg));
    const env = { CLAUDE_CONFIG_DIR: path.join(profileDir, '.claude') };
    const resolved = resolveConfig(path.join(tmp, 'project'), path.join(tmp, 'home'), env);
    expect(resolved.cfg.active_provider).toBe('profile');
  });

  it('still prefers project config over profile config', () => {
    const projectCfg = { active_provider: 'project' };
    const profileCfg = { active_provider: 'profile' };
    const homeCfg = { active_provider: 'home' };
    const profileDir = path.join(tmp, 'profile');
    fs.mkdirSync(path.join(tmp, 'project', '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'project', '.claude', 'middleware-config.json'), JSON.stringify(projectCfg));
    fs.mkdirSync(path.join(profileDir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(profileDir, '.claude', 'middleware-config.json'), JSON.stringify(profileCfg));
    fs.mkdirSync(path.join(tmp, 'home', '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'home', '.claude', 'middleware-config.json'), JSON.stringify(homeCfg));
    const env = { CLAUDE_CONFIG_DIR: path.join(profileDir, '.claude') };
    const resolved = resolveConfig(path.join(tmp, 'project'), path.join(tmp, 'home'), env);
    expect(resolved.cfg.active_provider).toBe('project');
  });

  it('falls through from corrupt profile config to home config', () => {
    const profileCfg = '{bad';
    const homeCfg = { active_provider: 'home' };
    const profileDir = path.join(tmp, 'profile');
    fs.mkdirSync(path.join(profileDir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(profileDir, '.claude', 'middleware-config.json'), profileCfg);
    fs.mkdirSync(path.join(tmp, 'home', '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'home', '.claude', 'middleware-config.json'), JSON.stringify(homeCfg));
    const env = { CLAUDE_CONFIG_DIR: path.join(profileDir, '.claude') };
    const resolved = resolveConfig(path.join(tmp, 'project'), path.join(tmp, 'home'), env);
    expect(resolved.cfg.active_provider).toBe('home');
  });
});

describe('endpointFor', () => {
  it('throws exit-2 when active_provider is not defined in endpoints', () => {
    const cfg = { active_provider: 'missing', endpoints: {} };
    try {
      endpointFor(cfg, {});
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.exit).toBe(2);
    }
  });

  it('throws exit-2 when key is missing for a remote endpoint', () => {
    const cfg = {
      active_provider: 'openrouter',
      endpoints: { openrouter: { model: 'x', base_url: 'https://openrouter.ai/api/v1', api_key_env: 'MISSING_KEY' } },
    };
    try {
      endpointFor(cfg, {});
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.exit).toBe(2);
    }
  });

  it('allows a localhost endpoint with no key set', () => {
    const cfg = {
      active_provider: 'ollama',
      endpoints: { ollama: { model: 'llama3', base_url: 'http://localhost:11434/v1', api_key_env: 'UNSET_KEY' } },
    };
    const result = endpointFor(cfg, {});
    expect(result.baseUrl).toBe('http://localhost:11434/v1');
    expect(result.model).toBe('llama3');
    expect(result.key).toBeUndefined();
  });

  it('treats a userinfo-authority host as remote, not localhost, requiring a key', () => {
    const cfg = {
      active_provider: 'sneaky',
      endpoints: { sneaky: { model: 'x', base_url: 'https://localhost:1@evil.example/v1', api_key_env: 'MISSING_KEY' } },
    };
    try {
      endpointFor(cfg, {});
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.exit).toBe(2);
    }
  });

  it('still allows keyless http://localhost:11434/v1', () => {
    const cfg = {
      active_provider: 'ollama',
      endpoints: { ollama: { model: 'llama3', base_url: 'http://localhost:11434/v1', api_key_env: 'UNSET_KEY' } },
    };
    expect(() => endpointFor(cfg, {})).not.toThrow();
  });

  it('still allows keyless http://127.0.0.1:4000', () => {
    const cfg = {
      active_provider: 'litellm',
      endpoints: { litellm: { model: 'x', base_url: 'http://127.0.0.1:4000', api_key_env: 'UNSET_KEY' } },
    };
    expect(() => endpointFor(cfg, {})).not.toThrow();
  });

  it('resolves key from env when present for a remote endpoint', () => {
    const cfg = {
      active_provider: 'openrouter',
      active_model: 'gpt-x',
      endpoints: { openrouter: { model: 'default-model', base_url: 'https://openrouter.ai/api/v1/', api_key_env: 'MY_KEY' } },
    };
    const result = endpointFor(cfg, { MY_KEY: 'secret123' });
    expect(result.key).toBe('secret123');
    expect(result.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(result.model).toBe('gpt-x');
  });
});

describe('renderTemplate', () => {
  it('renders a built-in template with input substitution', () => {
    const out = renderTemplate('extract-log-error', 'boom at line 1', {});
    expect(out).toContain('boom at line 1');
    expect(out).toContain('Extract the root-cause error');
  });

  it('config templates override built-ins', () => {
    const cfg = { templates: { 'extract-log-error': 'CUSTOM: {{input}}' } };
    const out = renderTemplate('extract-log-error', 'data', cfg);
    expect(out).toBe('CUSTOM: data');
  });

  it('config templates extend with new task names', () => {
    const cfg = { templates: { 'my-custom-task': 'DO: {{input}}' } };
    const out = renderTemplate('my-custom-task', 'thing', cfg);
    expect(out).toBe('DO: thing');
  });

  it('throws exit-1 listing known tasks for an unknown task', () => {
    try {
      renderTemplate('nonexistent-task', 'x', {});
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.exit).toBe(1);
      expect(e.message).toContain('extract-log-error');
      expect(e.message).toContain('summarize-test-failure');
      expect(e.message).toContain('scaffold-tests');
    }
  });

  it('truncates tail-first when input exceeds max_context_window * 3', () => {
    const cfg = { max_context_window: 10 };
    const input = 'a'.repeat(40) + 'TAIL_END';
    const out = renderTemplate('scaffold-tests', input, cfg);
    expect(out).toContain('[truncated');
    expect(out).toContain('TAIL_END');
    expect(out).not.toContain('a'.repeat(40));
  });

  it('does not truncate input at or below the cap', () => {
    const cfg = { max_context_window: 100 };
    const input = 'x'.repeat(50);
    const out = renderTemplate('scaffold-tests', input, cfg);
    expect(out).not.toContain('[truncated');
    expect(out).toContain(input);
  });

  it('preserves $-substitution patterns in input verbatim', () => {
    const input = '$$ pid and $& match and $` before';
    const out = renderTemplate('scaffold-tests', input, {});
    expect(out).toContain('$$ pid and $& match and $` before');
  });
});

describe('middleware-exec CLI end-to-end', () => {
  it('round-trips a request through a stub completions server', async () => {
    let receivedAuth, receivedBody;
    const canned = 'error: NullPointerException at foo.js:42';
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        receivedAuth = req.headers['authorization'];
        receivedBody = JSON.parse(raw);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: canned } }] }));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const projectDir = path.join(tmp, 'project');
    fs.mkdirSync(path.join(projectDir, '.claude'), { recursive: true });
    const config = {
      active_provider: 'teststub',
      active_model: 'test-model',
      endpoints: {
        teststub: {
          model: 'test-model',
          base_url: `http://127.0.0.1:${port}`,
          api_key_env: 'MW_TEST_KEY',
        },
      },
    };
    fs.writeFileSync(path.join(projectDir, '.claude', 'middleware-config.json'), JSON.stringify(config));

    const tmpLog = path.join(tmp, 'input.log');
    fs.writeFileSync(tmpLog, 'some log content\nwith an error\n');

    const cliPath = path.join(process.cwd(), 'scripts', 'middleware-exec.mjs');
    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [cliPath, '--task', 'extract-log-error', '--input-file', tmpLog],
        { cwd: projectDir, env: { ...process.env, MW_TEST_KEY: 'test' } },
      );
      expect(stdout).toBe(canned);
      expect(receivedAuth).toBe('Bearer test');
      expect(receivedBody.model).toBe('test-model');
      expect(receivedBody.messages[0].content).toContain('some log content');
    } finally {
      server.close();
    }
  });

  it('exits 1 for an unknown --task with a valid config', async () => {
    const projectDir = path.join(tmp, 'project-unknown-task');
    fs.mkdirSync(path.join(projectDir, '.claude'), { recursive: true });
    const config = {
      active_provider: 'ollama',
      active_model: 'llama3',
      endpoints: { ollama: { model: 'llama3', base_url: 'http://localhost:11434/v1', api_key_env: 'UNSET_KEY' } },
    };
    fs.writeFileSync(path.join(projectDir, '.claude', 'middleware-config.json'), JSON.stringify(config));
    const tmpLog = path.join(tmp, 'input-unknown.log');
    fs.writeFileSync(tmpLog, 'irrelevant content\n');
    const cliPath = path.join(process.cwd(), 'scripts', 'middleware-exec.mjs');

    await expect(
      execFileAsync(process.execPath, [cliPath, '--task', 'nonexistent-task', '--input-file', tmpLog], { cwd: projectDir, env: process.env }),
    ).rejects.toMatchObject({ code: 1 });
  });

  it('exits 2 when no config exists in project or home', async () => {
    const homeConfigPath = path.join(os.homedir(), '.claude', 'middleware-config.json');
    if (fs.existsSync(homeConfigPath)) {
      // Not hermetic on this machine — skip rather than assert against a config we don't control.
      return;
    }
    const projectDir = path.join(tmp, 'project-no-config');
    fs.mkdirSync(projectDir, { recursive: true });
    const tmpLog = path.join(tmp, 'input-noconfig.log');
    fs.writeFileSync(tmpLog, 'irrelevant content\n');
    const cliPath = path.join(process.cwd(), 'scripts', 'middleware-exec.mjs');

    await expect(
      execFileAsync(process.execPath, [cliPath, '--task', 'extract-log-error', '--input-file', tmpLog], { cwd: projectDir, env: process.env }),
    ).rejects.toMatchObject({ code: 2 });
  });

  it('exits 3 with stderr containing "endpoint 500" on a non-2xx response', async () => {
    const server = http.createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('internal server error');
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const projectDir = path.join(tmp, 'project-500');
    fs.mkdirSync(path.join(projectDir, '.claude'), { recursive: true });
    const config = {
      active_provider: 'teststub',
      active_model: 'test-model',
      endpoints: { teststub: { model: 'test-model', base_url: `http://127.0.0.1:${port}`, api_key_env: 'MW_TEST_KEY' } },
    };
    fs.writeFileSync(path.join(projectDir, '.claude', 'middleware-config.json'), JSON.stringify(config));
    const tmpLog = path.join(tmp, 'input-500.log');
    fs.writeFileSync(tmpLog, 'irrelevant content\n');
    const cliPath = path.join(process.cwd(), 'scripts', 'middleware-exec.mjs');

    try {
      await expect(
        execFileAsync(
          process.execPath,
          [cliPath, '--task', 'extract-log-error', '--input-file', tmpLog],
          { cwd: projectDir, env: { ...process.env, MW_TEST_KEY: 'test' } },
        ),
      ).rejects.toMatchObject({ code: 3, stderr: expect.stringContaining('endpoint 500') });
    } finally {
      server.close();
    }
  });
});

describe('transport dispatch', () => {
  it('defaults to http when transport is absent', () => {
    const cfg = { active_provider: 'p', endpoints: { p: { model: 'm', base_url: 'http://localhost:1/v1' } } };
    expect(endpointFor(cfg, {}).transport).toBe('http');
  });

  it('accepts an explicit http transport identically', () => {
    const cfg = { active_provider: 'p', endpoints: { p: { transport: 'http', model: 'm', base_url: 'http://localhost:1/v1' } } };
    const r = endpointFor(cfg, {});
    expect(r.transport).toBe('http');
    expect(r.baseUrl).toBe('http://localhost:1/v1');
  });

  it('throws exit-2 for an unknown transport', () => {
    const cfg = { active_provider: 'p', endpoints: { p: { transport: 'carrier-pigeon', model: 'm' } } };
    try { endpointFor(cfg, {}); throw new Error('should have thrown'); }
    catch (e) { expect(e.exit).toBe(2); expect(e.message).toMatch(/carrier-pigeon/); }
  });
});

// Fake CLIs built from the running Node binary: real spawn behavior, no
// network, no model cost.
const NODE = process.execPath;
const echoStdin = ['-e', 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(s))'];
const echoArgv  = ['-e', 'process.stdout.write(process.argv[1]||"")'];

const cliCfg = (ep) => ({ active_provider: 'c', endpoints: { c: { transport: 'cli', ...ep } } });

// Spawning tests MUST pass a real environment. A child spawned with env {} has
// no SystemRoot on Windows and can fail for reasons unrelated to the assertion.
// Validation-only tests (which never spawn) may pass {}.
const desc = (ep, env = process.env) => endpointFor(cliCfg(ep), env);

describe('runCli delivery', () => {
  it('returns child stdout for stdin delivery', async () => {
    const d = desc({ command: [NODE, ...echoStdin], input_mode: 'stdin' });
    expect(await runCli(d, 'hello middleware')).toBe('hello middleware');
  });

  it('substitutes {{prompt}} as a single argv element', async () => {
    const d = desc({ command: [NODE, ...echoArgv, '{{prompt}}'], input_mode: 'argv' });
    expect(await runCli(d, 'two words "quoted"')).toBe('two words "quoted"');
  });

  it('does not interpret $& or $` in the prompt (function replacer)', async () => {
    const d = desc({ command: [NODE, ...echoArgv, '{{prompt}}'], input_mode: 'argv' });
    const nasty = 'cost $& and $` and $1 and $\'';
    expect(await runCli(d, nasty)).toBe(nasty);
  });

  it('strips ANSI escapes from stdout', async () => {
    const ansi = ['-e', 'process.stdout.write("\\u001B[31mred\\u001B[0m")'];
    const d = desc({ command: [NODE, ...ansi], input_mode: 'stdin' });
    expect(await runCli(d, '')).toBe('red');
  });

  it('runs in a temp cwd, not the project', async () => {
    const probe = ['-e', 'process.stdout.write(process.cwd())'];
    const d = desc({ command: [NODE, ...probe], input_mode: 'stdin' });
    const out = await runCli(d, '');
    expect(path.resolve(out)).not.toBe(path.resolve(process.cwd()));
  });

  it('honors an explicit cwd override', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-cwd-'));
    const probe = ['-e', 'process.stdout.write(process.cwd())'];
    const d = desc({ command: [NODE, ...probe], input_mode: 'stdin', cwd: dir });
    expect(fs.realpathSync(await runCli(d, ''))).toBe(fs.realpathSync(dir));
  });

  it('merges env over the parent instead of replacing it', async () => {
    const probe = ['-e', 'process.stdout.write((process.env.MW_TEST||"")+"|"+(process.env.PATH?"has-path":"no-path"))'];
    const d = desc({ command: [NODE, ...probe], input_mode: 'stdin', env: { MW_TEST: 'v' } });
    expect(await runCli(d, '')).toBe('v|has-path');
  });
});

describe('runCli guards', () => {
  it('rejects oversized argv with exit 3 and a stdin suggestion', async () => {
    const d = desc({
      command: [NODE, '-e', 'process.stdout.write("x")', '{{prompt}}'],
      input_mode: 'argv', max_argv_bytes: 100,
    });
    const e = await runCli(d, 'y'.repeat(101)).then(() => null, (err) => err);
    expect(e).toBeTruthy();
    expect(e.exit).toBe(3);
    expect(e.message).toMatch(/101/);
    expect(e.message).toMatch(/stdin/);
  });

  it('does not size-check stdin mode', async () => {
    const d = desc({
      command: [NODE, '-e', 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(s.length)))'],
      input_mode: 'stdin', max_argv_bytes: 10,
    });
    expect(await runCli(d, 'z'.repeat(5000))).toBe('5000');
  });

  it('kills a child that outlives timeout_ms (exit 3)', async () => {
    const d = desc({
      command: [NODE, '-e', 'setTimeout(()=>{},60000)'],
      input_mode: 'stdin', timeout_ms: 300,
    });
    const e = await runCli(d, '').then(() => null, (err) => err);
    expect(e?.exit).toBe(3);
    expect(e.message).toMatch(/timed out/);
  }, 10000);

  it('times out even when the child never reads stdin', async () => {
    // 200KB overflows the ~64KB pipe buffer. If the timer were armed after the
    // stdin write, this would hang forever instead of rejecting.
    const d = desc({
      command: [NODE, '-e', 'process.stdin.pause();setTimeout(()=>{},60000)'],
      input_mode: 'stdin', timeout_ms: 300,
    });
    const e = await runCli(d, 'q'.repeat(200000)).then(() => null, (err) => err);
    expect(e?.exit).toBe(3);
  }, 10000);

  it('maps ENOENT to exit 2 with the Windows shim hint', async () => {
    const d = desc({ command: ['definitely-not-a-real-binary-xyz'], input_mode: 'stdin' });
    const e = await runCli(d, '').then(() => null, (err) => err);
    expect(e?.exit).toBe(2);
    expect(e.message).toMatch(/\.cmd/);
  });

  it('maps a non-zero child exit to exit 3 with stderr tail', async () => {
    const d = desc({
      command: [NODE, '-e', 'process.stderr.write("boom detail");process.exit(4)'],
      input_mode: 'stdin',
    });
    const e = await runCli(d, '').then(() => null, (err) => err);
    expect(e?.exit).toBe(3);
    expect(e.message).toMatch(/boom detail/);
  });

  it('rejects a command containing a non-string element with exit 2', () => {
    const boom = (ep) => { try { endpointFor(cliCfg(ep), {}); return null; } catch (e) { return e; } };
    expect(boom({ command: [123, '{{prompt}}'], input_mode: 'argv' })?.exit).toBe(2);
    expect(boom({ command: ['ok', 42, '{{prompt}}'], input_mode: 'argv' })?.exit).toBe(2);
  });

  it('removes a temp cwd it created, but never a configured one', async () => {
    const probe = ['-e', 'process.stdout.write(process.cwd())'];
    const auto = desc({ command: [NODE, ...probe], input_mode: 'stdin' });
    const tempUsed = await runCli(auto, '');
    expect(fs.existsSync(tempUsed)).toBe(false);

    const mine = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-keep-'));
    const explicit = desc({ command: [NODE, ...probe], input_mode: 'stdin', cwd: mine });
    await runCli(explicit, '');
    expect(fs.existsSync(mine)).toBe(true);
  });

  it('removes the temp cwd even when the run times out', async () => {
    const probe = ['-e', 'process.stdout.write(process.cwd());setTimeout(()=>{},60000)'];
    const d = desc({ command: [NODE, ...probe], input_mode: 'stdin', timeout_ms: 300 });
    const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('sp-mw-'));
    const e = await runCli(d, '').then(() => null, (err) => err);
    expect(e?.exit).toBe(3);
    // Give the OS a moment to release the handle and the close event to fire.
    await new Promise((r) => setTimeout(r, 500));
    const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('sp-mw-'));
    expect(after.length).toBeLessThanOrEqual(before.length);
  }, 10000);
});

describe('cli config validation', () => {
  const boom = (ep) => { try { endpointFor(cliCfg(ep), {}); return null; } catch (e) { return e; } };

  it('rejects preset and command together', () => {
    expect(boom({ preset: 'agy', command: ['x', '{{prompt}}'] })?.exit).toBe(2);
  });
  it('rejects neither preset nor command', () => {
    expect(boom({})?.exit).toBe(2);
  });
  it('rejects stdin mode with a {{prompt}} placeholder', () => {
    expect(boom({ command: ['x', '{{prompt}}'], input_mode: 'stdin' })?.exit).toBe(2);
  });
  it('rejects argv mode without a {{prompt}} placeholder', () => {
    expect(boom({ command: ['x'], input_mode: 'argv' })?.exit).toBe(2);
  });

  it('rejects a non-numeric max_argv_bytes', () => {
    expect(boom({ command: ['x', '{{prompt}}'], input_mode: 'argv', max_argv_bytes: 'lots' })?.exit).toBe(2);
  });
  it('rejects a zero or negative timeout_ms', () => {
    expect(boom({ command: ['x'], input_mode: 'stdin', timeout_ms: 0 })?.exit).toBe(2);
    expect(boom({ command: ['x'], input_mode: 'stdin', timeout_ms: -5 })?.exit).toBe(2);
  });
  it('defaults timeout_ms and max_argv_bytes when omitted', () => {
    const d = endpointFor(cliCfg({ command: ['x'], input_mode: 'stdin' }), {});
    expect(d.timeoutMs).toBe(120000);
    expect(d.maxArgvBytes).toBe(30000);
  });

  it('rejects a non-string cwd', () => {
    expect(boom({ command: ['x'], input_mode: 'stdin', cwd: 5 })?.exit).toBe(2);
  });
  it('rejects an empty-string cwd', () => {
    expect(boom({ command: ['x'], input_mode: 'stdin', cwd: '' })?.exit).toBe(2);
  });
});

describe('cli presets', () => {
  const p = (ep, cfgExtra = {}) => endpointFor({ active_provider: 'c', ...cfgExtra, endpoints: { c: { transport: 'cli', ...ep } } }, {});

  it('ships exactly the three verified presets', () => {
    expect(Object.keys(PRESETS).sort()).toEqual(['agy', 'claude', 'opencode']);
  });

  it('expands the agy preset with a prompt placeholder', () => {
    const d = p({ preset: 'agy' });
    expect(d.command[0]).toBe('agy');
    expect(d.command).toContain('{{prompt}}');
  });

  it('inserts the model flag before the prompt argument', () => {
    const d = p({ preset: 'agy', model: 'gemini-3-pro' });
    const i = d.command.indexOf('gemini-3-pro');
    expect(i).toBeGreaterThan(0);
    expect(d.command[i - 1]).toBe(PRESETS.agy.modelFlag);
    expect(i).toBeLessThan(d.command.indexOf('{{prompt}}'));
  });

  it('emits no model flag when no model is given', () => {
    expect(p({ preset: 'agy' }).command).not.toContain(PRESETS.agy.modelFlag);
  });

  it('lets active_model override the endpoint model', () => {
    const d = p({ preset: 'agy', model: 'a' }, { active_model: 'b' });
    expect(d.command).toContain('b');
    expect(d.command).not.toContain('a');
  });

  it('defaults input_mode from Task 4 evidence', () => {
    expect(p({ preset: 'agy' }).inputMode).toBe('argv');
    expect(p({ preset: 'opencode' }).inputMode).toBe('stdin');
    expect(p({ preset: 'claude' }).inputMode).toBe('stdin');
  });

  it('uses the stdin arg form when the mode is stdin (no placeholder)', () => {
    const d = p({ preset: 'claude' });
    expect(d.command).not.toContain('{{prompt}}');
    expect(d.command).toEqual([...PRESETS.claude.base, ...PRESETS.claude.stdinArgs]);
  });

  it('lets an explicit input_mode override the preset default, swapping the arg form', () => {
    const argv = p({ preset: 'claude', input_mode: 'argv' });
    expect(argv.inputMode).toBe('argv');
    expect(argv.command).toContain('{{prompt}}');

    const stdin = p({ preset: 'agy', input_mode: 'stdin' });
    expect(stdin.inputMode).toBe('stdin');
    expect(stdin.command).not.toContain('{{prompt}}');
  });

  it('rejects an unknown preset with exit 2 listing known names', () => {
    try { p({ preset: 'nope' }); throw new Error('should have thrown'); }
    catch (e) { expect(e.exit).toBe(2); expect(e.message).toMatch(/agy/); }
  });

  it('places the opencode model flag after the run subcommand', () => {
    const d = p({ preset: 'opencode', model: 'X' });
    expect(d.command.indexOf('run')).toBeLessThan(d.command.indexOf('-m'));
    expect(d.command).toEqual(['opencode', 'run', '-m', 'X']);
  });
});
