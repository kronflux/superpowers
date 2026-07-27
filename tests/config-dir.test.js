import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { configDir, userCandidates } from '../hooks/lib/config-dir.js';

describe('configDir', () => {
  it('prefers CLAUDE_CONFIG_DIR', () => {
    expect(configDir({ CLAUDE_CONFIG_DIR: '/p/prof' })).toBe('/p/prof');
  });
  it('falls back to HOME/.claude then USERPROFILE/.claude', () => {
    expect(configDir({ HOME: '/h' })).toBe(path.join('/h', '.claude'));
    expect(configDir({ USERPROFILE: '/u' })).toBe(path.join('/u', '.claude'));
    expect(configDir({})).toBe(path.join('.', '.claude'));
  });
});

describe('userCandidates', () => {
  it('lists configRoot first, legacy home second', () => {
    const c = userCandidates(['superpowers', 'x.json'], { CLAUDE_CONFIG_DIR: '/p/prof' });
    expect(c[0]).toBe(path.join('/p/prof', 'superpowers', 'x.json'));
    expect(c[1]).toBe(path.join(os.homedir(), '.claude', 'superpowers', 'x.json'));
  });
  it('dedupes when configRoot IS legacy home', () => {
    const env = { HOME: os.homedir() };
    expect(userCandidates(['x.json'], env)).toHaveLength(1);
  });
});
