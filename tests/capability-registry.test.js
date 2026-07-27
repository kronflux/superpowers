import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { probe, summaryLine, STATUS } from '../hooks/lib/capability-registry.js';

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capreg-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('capability-registry', () => {
  it('returns all seven capabilities as absent in an empty dir', () => {
    const caps = probe(tmp, { home: tmp, env: { PATH: '' } });
    expect(Object.keys(caps).sort()).toEqual(
      ['basic-memory', 'codegraph', 'context7', 'docfork', 'middleware', 'obsidian-cli', 'serena'].sort());
    for (const v of Object.values(caps)) expect(v.status).toBe(STATUS.ABSENT);
  });

  it('detects serena from project .mcp.json', () => {
    fs.writeFileSync(path.join(tmp, '.mcp.json'), JSON.stringify({ mcpServers: { serena: {} } }));
    expect(probe(tmp, { home: tmp, env: { PATH: '' } }).serena.status).toBe(STATUS.CONFIGURED);
  });

  it('detects context7 from home .claude.json project scope', () => {
    fs.writeFileSync(path.join(tmp, '.claude.json'),
      JSON.stringify({ projects: { [tmp]: { mcpServers: { 'context7-mcp': {} } } } }));
    expect(probe(tmp, { home: tmp, env: { PATH: '' } }).context7.status).toBe(STATUS.CONFIGURED);
  });

  it('ignores unrelated projects in .claude.json', () => {
    const otherPath = path.join(tmp, 'other-project');
    fs.writeFileSync(path.join(tmp, '.claude.json'),
      JSON.stringify({ projects: { [otherPath]: { mcpServers: { 'context7-mcp': {} } } } }));
    expect(probe(tmp, { home: tmp, env: { PATH: '' } }).context7.status).toBe(STATUS.ABSENT);
  });

  it('detects codegraph index dir and decline marker', () => {
    fs.mkdirSync(path.join(tmp, '.codegraph'));
    fs.writeFileSync(path.join(tmp, '.superpowers-no-codegraph'), '');
    const cg = probe(tmp, { home: tmp, env: { PATH: '' } }).codegraph;
    expect(cg.indexed).toBe(true);
    expect(cg.declined).toBe(true);
  });

  it('detects middleware config in project .claude dir', () => {
    fs.mkdirSync(path.join(tmp, '.claude'));
    fs.writeFileSync(path.join(tmp, '.claude', 'middleware-config.json'), '{}');
    expect(probe(tmp, { home: tmp, env: { PATH: '' } }).middleware.status).toBe(STATUS.CONFIGURED);
  });

  it('survives corrupt config json', () => {
    fs.writeFileSync(path.join(tmp, '.mcp.json'), '{not json');
    expect(() => probe(tmp, { home: tmp, env: { PATH: '' } })).not.toThrow();
  });

  it('summaryLine stays within 120 chars with everything present', () => {
    const caps = probe(tmp, { home: tmp, env: { PATH: '' } });
    for (const v of Object.values(caps)) v.status = STATUS.CONFIGURED;
    expect(summaryLine(caps).length).toBeLessThanOrEqual(120);
  });

  it('probes decline markers for serena, context7, middleware, obsidian-cli', () => {
    fs.writeFileSync(path.join(tmp, '.superpowers-no-serena'), '');
    fs.writeFileSync(path.join(tmp, '.superpowers-no-middleware'), '');
    const caps = probe(tmp, { home: tmp, env: { PATH: '' } });
    expect(caps.serena.declined).toBe(true);
    expect(caps.middleware.declined).toBe(true);
    expect(caps.context7.declined).toBe(false);
    expect(caps['obsidian-cli'].declined).toBe(false);
  });

  it('detects serena from configRoot .claude.json via CLAUDE_CONFIG_DIR', () => {
    const prof = path.join(tmp, 'prof'); fs.mkdirSync(prof, { recursive: true });
    fs.writeFileSync(path.join(prof, '.claude.json'), JSON.stringify({ mcpServers: { serena: {} } }));
    const caps = probe(tmp, { home: tmp, env: { PATH: '', CLAUDE_CONFIG_DIR: prof } });
    expect(caps.serena.status).toBe(STATUS.CONFIGURED);
  });

  it('detects a plugin-installed MCP server via installed_plugins.json', () => {
    const prof = path.join(tmp, 'prof');
    const inst = path.join(prof, 'plugins', 'cache', 'm', 'serena', '1.0.0');
    fs.mkdirSync(inst, { recursive: true });
    fs.writeFileSync(path.join(inst, '.mcp.json'), JSON.stringify({ mcpServers: { serena: {} } }));
    fs.mkdirSync(path.join(prof, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(prof, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ version: 1, plugins: { 'serena@m': [{ installPath: inst }] } }));
    const caps = probe(tmp, { home: tmp, env: { PATH: '', CLAUDE_CONFIG_DIR: prof } });
    expect(caps.serena.status).toBe(STATUS.CONFIGURED);
  });

  it('excludes a disabled plugin', () => {
    const prof = path.join(tmp, 'prof');
    const inst = path.join(prof, 'plugins', 'cache', 'm', 'serena', '1.0.0');
    fs.mkdirSync(inst, { recursive: true });
    fs.writeFileSync(path.join(inst, '.mcp.json'), JSON.stringify({ mcpServers: { serena: {} } }));
    fs.mkdirSync(path.join(prof, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(prof, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ version: 1, plugins: { 'serena@m': [{ installPath: inst }] } }));
    fs.writeFileSync(path.join(prof, 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'serena@m': false } }));
    const caps = probe(tmp, { home: tmp, env: { PATH: '', CLAUDE_CONFIG_DIR: prof } });
    expect(caps.serena.status).toBe(STATUS.ABSENT);
  });

  it('treats installed as enabled when settings.json or the field is absent', () => {
    const prof = path.join(tmp, 'prof');
    const inst = path.join(prof, 'plugins', 'cache', 'm', 'serena', '1.0.0');
    fs.mkdirSync(inst, { recursive: true });
    fs.writeFileSync(path.join(inst, '.mcp.json'), JSON.stringify({ mcpServers: { serena: {} } }));
    fs.mkdirSync(path.join(prof, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(prof, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ version: 1, plugins: { 'serena@m': [{ installPath: inst }] } }));
    const caps = probe(tmp, { home: tmp, env: { PATH: '', CLAUDE_CONFIG_DIR: prof } });
    expect(caps.serena.status).toBe(STATUS.CONFIGURED);
  });

  it('detects obsidian by bare binary name', () => {
    const bin = path.join(tmp, 'bin'); fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, process.platform === 'win32' ? 'obsidian.exe' : 'obsidian'), '');
    const caps = probe(tmp, { home: tmp, env: { PATH: bin, CLAUDE_CONFIG_DIR: path.join(tmp, 'none') } });
    expect(caps['obsidian-cli'].status).toBe(STATUS.CONFIGURED);
  });

  it('survives corrupt installed_plugins.json and settings.json', () => {
    const prof = path.join(tmp, 'prof'); fs.mkdirSync(path.join(prof, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(prof, 'plugins', 'installed_plugins.json'), '{bad');
    fs.writeFileSync(path.join(prof, 'settings.json'), '{bad');
    let caps;
    expect(() => { caps = probe(tmp, { home: tmp, env: { PATH: '', CLAUDE_CONFIG_DIR: prof } }); }).not.toThrow();
    expect(caps.serena.status).toBe(STATUS.ABSENT);
  });
});
