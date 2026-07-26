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
    expect(resolveConfig(tmp, tmp)).toBeNull();
  });

  it('prefers project .claude/middleware-config.json over home', () => {
    const projectCfg = { active_provider: 'project' };
    const homeCfg = { active_provider: 'home' };
    fs.mkdirSync(path.join(tmp, 'project', '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'project', '.claude', 'middleware-config.json'), JSON.stringify(projectCfg));
    fs.mkdirSync(path.join(tmp, 'home', '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'home', '.claude', 'middleware-config.json'), JSON.stringify(homeCfg));
    const resolved = resolveConfig(path.join(tmp, 'project'), path.join(tmp, 'home'));
    expect(resolved.cfg.active_provider).toBe('project');
  });

  it('falls back to home config when project config is absent', () => {
    const homeCfg = { active_provider: 'home' };
    fs.mkdirSync(path.join(tmp, 'project'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'home', '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'home', '.claude', 'middleware-config.json'), JSON.stringify(homeCfg));
    const resolved = resolveConfig(path.join(tmp, 'project'), path.join(tmp, 'home'));
    expect(resolved.cfg.active_provider).toBe('home');
    expect(resolved.source).toBe(path.join(tmp, 'home', '.claude', 'middleware-config.json'));
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
});
