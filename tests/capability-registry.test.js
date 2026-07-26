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
});
