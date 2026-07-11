import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
it('CLAUDE.md and AGENTS.md are identical', () =>
  expect(readFileSync('CLAUDE.md', 'utf8')).toBe(readFileSync('AGENTS.md', 'utf8')));
