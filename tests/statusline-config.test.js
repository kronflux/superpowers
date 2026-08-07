import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';
import { loadConfig, DEFAULT_CONFIG, SEGMENT_IDS } from '../hooks/lib/statusline-config.js';

let cwd;
beforeEach(() => { cwd = fs.mkdtempSync(path.join(spTmpDir(), 'slcfg-')); });
afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

function write(obj) {
  fs.mkdirSync(path.join(cwd, '.superpowers'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.superpowers', 'statusline.json'),
    typeof obj === 'string' ? obj : JSON.stringify(obj));
}

describe('statusline-config', () => {
  it('returns defaults when the file is absent', () => {
    expect(loadConfig(cwd)).toEqual(DEFAULT_CONFIG);
  });

  it('returns defaults on malformed JSON rather than throwing', () => {
    write('{not json');
    let cfg;
    expect(() => { cfg = loadConfig(cwd); }).not.toThrow();
    expect(cfg).toEqual(DEFAULT_CONFIG);
  });

  it('drops unknown segment ids and preserves file order', () => {
    write({ segments: ['usage', 'nope', 'capabilities'] });
    expect(loadConfig(cwd).segments).toEqual(['usage', 'capabilities']);
  });

  it('preserves an empty segments array', () => {
    // The user turning every segment off is a real choice, not a missing value.
    write({ segments: [] });
    expect(loadConfig(cwd).segments).toEqual([]);
  });

  it('defaults the separator and rejects a non-string', () => {
    write({ segments: ['usage'] });
    expect(loadConfig(cwd).separator).toBe(DEFAULT_CONFIG.separator);
    write({ segments: ['usage'], separator: 42 });
    expect(loadConfig(cwd).separator).toBe(DEFAULT_CONFIG.separator);
  });

  it('exposes exactly the four known segment ids', () => {
    expect([...SEGMENT_IDS].sort()).toEqual(['capabilities', 'delegation', 'plan', 'usage']);
  });
});
