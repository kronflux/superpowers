import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';
import { tailLines } from '../hooks/lib/tail-read.js';

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(spTmpDir(), 'tail-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('tailLines', () => {
  it('returns [] for a missing file without throwing', () => {
    let out;
    expect(() => { out = tailLines(path.join(dir, 'nope.log')); }).not.toThrow();
    expect(out).toEqual([]);
  });

  it('returns every line of a small file', () => {
    const f = path.join(dir, 'small.log');
    fs.writeFileSync(f, 'a\nb\nc\n');
    expect(tailLines(f)).toEqual(['a', 'b', 'c']);
  });

  it('reads at most maxBytes and drops the partial leading line', () => {
    const f = path.join(dir, 'big.log');
    // 500 lines of 20 bytes = 10000 bytes; a 100-byte window lands mid-line.
    fs.writeFileSync(f, Array.from({ length: 500 }, (_, i) => String(i).padStart(19, '0')).join('\n') + '\n');
    const out = tailLines(f, 100);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(10);
    // Every returned line must be a whole 19-char record, never a fragment.
    for (const l of out) expect(l).toHaveLength(19);
    expect(out[out.length - 1]).toBe('0000000000000000499');
  });

  it('returns [] for an empty file', () => {
    const f = path.join(dir, 'empty.log');
    fs.writeFileSync(f, '');
    expect(tailLines(f)).toEqual([]);
  });
});
