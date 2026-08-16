import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';
import { dedupeReason, markerPath } from '../hooks/lib/rejection-dedup.js';

const written = [];
afterAll(() => { for (const f of written) fs.rmSync(f, { force: true }); });

const LONG = ['PLAN TASK MISSING METADATA FENCE', '', 'line three', 'line four'].join('\n');

describe('dedupeReason', () => {
  it('returns the full reason the first time', () => {
    written.push(markerPath('s1', 'taskcreate', 'missing-fence'));
    const out = dedupeReason({ sessionId: 's1', hook: 'taskcreate', ruleId: 'missing-fence', reason: LONG, subject: 'Task 1' });
    expect(out).toBe(LONG);
  });

  it('returns one line the second time', () => {
    const out = dedupeReason({ sessionId: 's1', hook: 'taskcreate', ruleId: 'missing-fence', reason: LONG, subject: 'Task 2' });
    expect(out.split('\n')).toHaveLength(1);
    expect(out).toContain('missing-fence');
    expect(out).toContain('Task 2');
  });

  it('returns the full reason for a different rule in the same session', () => {
    written.push(markerPath('s1', 'taskcreate', 'missing-tier'));
    const out = dedupeReason({ sessionId: 's1', hook: 'taskcreate', ruleId: 'missing-tier', reason: LONG, subject: 'Task 3' });
    expect(out).toBe(LONG);
  });

  it('returns the full reason for the same rule under a different hook', () => {
    written.push(markerPath('s1', 'comment-gate', 'missing-fence'));
    const out = dedupeReason({ sessionId: 's1', hook: 'comment-gate', ruleId: 'missing-fence', reason: LONG, subject: 'a.js' });
    expect(out).toBe(LONG);
  });

  it('returns the full reason in a different session', () => {
    written.push(markerPath('s2', 'taskcreate', 'missing-fence'));
    const out = dedupeReason({ sessionId: 's2', hook: 'taskcreate', ruleId: 'missing-fence', reason: LONG, subject: 'Task 4' });
    expect(out).toBe(LONG);
  });

  it('stores its marker under the sp/ temp root', () => {
    expect(path.dirname(markerPath('s3', 'taskcreate', 'x'))).toBe(spTmpDir());
  });

  it('sanitises a traversal payload into a single marker name inside the sp/ root', () => {
    const marker = markerPath('../../..', 'taskcreate', 'x');
    written.push(marker);
    expect(path.dirname(marker)).toBe(spTmpDir());
    expect(path.basename(marker)).not.toMatch(/[\\/]/);
  });

  it('returns the full reason when the marker write fails for a reason other than EEXIST', () => {
    const marker = markerPath('s4', 'taskcreate', 'missing-fence');
    written.push(marker);
    const spy = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
      const err = new Error('permission denied');
      err.code = 'EACCES';
      throw err;
    });
    try {
      const out = dedupeReason({ sessionId: 's4', hook: 'taskcreate', ruleId: 'missing-fence', reason: LONG, subject: 'Task 5' });
      expect(out).toBe(LONG);
    } finally {
      spy.mockRestore();
    }
  });
});
