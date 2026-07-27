import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveConfig, endpointFor, renderTemplate } from '../scripts/middleware-exec.mjs';

const execFileAsync = promisify(execFile);

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mwexec-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('resolveConfig', () => {
  it('returns null when neither project nor home config exists', () => {
    expect(resolveConfig(tmp, tmp, {})).toBeNull();
  });

  it('prefers project .claude/middleware-config.json over home', () => {
    const projectCfg = { active_provider: 'project' };
    const homeCfg = { active_provider: 'home' };
    fs.mkdirSync(path.join(tmp, 'project', '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'project', '.claude', 'middleware-config.json'), JSON.stringify(projectCfg));
    fs.mkdirSync(path.join(tmp, 'home', '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'home', '.claude', 'middleware-config.json'), JSON.stringify(homeCfg));
    const resolved = resolveConfig(path.join(tmp, 'project'), path.join(tmp, 'home'), {});
    expect(resolved.cfg.active_provider).toBe('project');
  });

  it('falls back to home config when project config is absent', () => {
    const homeCfg = { active_provider: 'home' };
    fs.mkdirSync(path.join(tmp, 'project'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'home', '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'home', '.claude', 'middleware-config.json'), JSON.stringify(homeCfg));
    const resolved = resolveConfig(path.join(tmp, 'project'), path.join(tmp, 'home'), {});
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
