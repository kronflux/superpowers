import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const j = (p) => JSON.parse(readFileSync(p, 'utf8'));
const expected = j('package.json').version;
const entries = j('.version-bump.json').files;
const getField = (obj, dotted) => dotted.split('.').reduce((o, k) => o?.[k], obj);

describe('manifest version consistency', () => {
  it('.version-bump.json covers the six known manifests', () => {
    const paths = entries.map((f) => f.path);
    for (const p of [
      '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json',
      '.codex-plugin/plugin.json', '.cursor-plugin/plugin.json',
      '.kimi-plugin/plugin.json', 'gemini-extension.json',
    ]) expect(paths).toContain(p);
  });
  for (const f of entries)
    it(`${f.path} ${f.field} == package.json (${expected})`, () =>
      expect(getField(j(f.path), f.field)).toBe(expected));
});
