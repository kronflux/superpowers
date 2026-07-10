import { describe, it, expect } from 'vitest';
import { RULES, NEVER_COMPRESS, MIN_OUTPUT_LENGTH } from '../hooks/compression-rules.js';

describe('compression-rules', () => {
  it('exports rules and constants', () => {
    expect(RULES.length).toBeGreaterThan(10);
    expect(MIN_OUTPUT_LENGTH).toBe(200);
  });

  it('never-compress list covers raw-read commands', () => {
    const joined = NEVER_COMPRESS.map(String).join(' ');
    for (const cmd of ['diff', 'cat', 'head']) expect(joined).toContain(cmd);
  });

  it('git-status rule compresses long output', () => {
    const rule = RULES.find(r => r.type === 'git-status');
    // git-status compression strips git hint lines ('  (use "git ...")').
    const raw = 'On branch main\n'
      + 'M a.js\n'.repeat(50)
      + '  (use "git add <file>..." to update what will be committed)\n'.repeat(100);
    const out = rule.compress(raw, '', 0);
    expect(out.length).toBeLessThan(raw.length);
  });
});
