import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { isContextModeActive, _cacheFile } from '../hooks/lib/ctx-detect.js';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';

let sessionIds;
function freshSession() {
  const id = 'test-' + Math.random().toString(36).slice(2);
  try { fs.unlinkSync(_cacheFile(id)); } catch {}
  sessionIds.push(id);
  return id;
}

describe('ctx-detect', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(spTmpDir(), 'ctxd-')); sessionIds = []; });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const id of sessionIds) fs.rmSync(_cacheFile(id), { force: true });
  });

  it('INACTIVE: no signals present', () => {
    const sid = freshSession();
    const r = isContextModeActive({
      sessionId: sid,
      env: {},
      configDir: tmp,
      installedPluginsPath: path.join(tmp, 'missing.json'),
    });
    expect(r).toBe(false);
  });

  it('ACTIVE via MCP tool marker env var', () => {
    const sid = freshSession();
    const r = isContextModeActive({
      sessionId: sid,
      env: { CLAUDE_MCP_TOOLS: 'mcp__plugin_context-mode_context-mode__ctx_search' },
      configDir: tmp,
      installedPluginsPath: path.join(tmp, 'missing.json'),
    });
    expect(r).toBe(true);
  });

  it('ACTIVE via installed_plugins.json substring', () => {
    const sid = freshSession();
    const ip = path.join(tmp, 'installed_plugins.json');
    fs.writeFileSync(ip, JSON.stringify({ plugins: { 'context-mode': { version: '1.0.162' } } }));
    const r = isContextModeActive({
      sessionId: sid, env: {}, configDir: tmp, installedPluginsPath: ip,
    });
    expect(r).toBe(true);
  });

  it('ACTIVE via configDir/context-mode/sessions existing', () => {
    const sid = freshSession();
    fs.mkdirSync(path.join(tmp, 'context-mode', 'sessions'), { recursive: true });
    const r = isContextModeActive({
      sessionId: sid, env: {}, configDir: tmp,
      installedPluginsPath: path.join(tmp, 'missing.json'),
    });
    expect(r).toBe(true);
  });

  it('caches per session: second call ignores changed signals', () => {
    const sid = freshSession();
    const ip = path.join(tmp, 'missing.json');
    const first = isContextModeActive({ sessionId: sid, env: {}, configDir: tmp, installedPluginsPath: ip });
    expect(first).toBe(false);
    // Now add a signal; cached false must be returned for the same session.
    fs.mkdirSync(path.join(tmp, 'context-mode', 'sessions'), { recursive: true });
    const second = isContextModeActive({ sessionId: sid, env: {}, configDir: tmp, installedPluginsPath: ip });
    expect(second).toBe(false);
  });

  it('cache file lives under the sp/ tmp root as ctx-<sessionId>.json', () => {
    expect(_cacheFile('abc')).toBe(path.join(spTmpDir(), 'ctx-abc.json'));
  });
});
