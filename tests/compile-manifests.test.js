import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, build, TARGETS, VALID_EVENTS } from '../scripts/compile-hooks.mjs';
import manifest from '../plugin.universal.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['hooks/hooks.json', 'hooks/codex-hooks.json', 'hooks/hooks-cursor.json'];

describe('compile-hooks idempotence', () => {
  it('regenerating produces byte-identical committed manifests', () => {
    const before = FILES.map((f) => readFileSync(join(ROOT, f), 'utf8'));
    execSync('node scripts/compile-hooks.mjs', { cwd: ROOT });
    FILES.forEach((f, i) => expect(readFileSync(join(ROOT, f), 'utf8')).toBe(before[i]));
  });

  it('build() output matches committed files for every platform', () => {
    const outputs = build();
    for (const [platform, relPath] of Object.entries(TARGETS)) {
      expect(outputs[platform]).toBe(readFileSync(join(ROOT, relPath), 'utf8'));
    }
  });
});

describe('compile-hooks validation', () => {
  const good = { event: 'Stop', command: 'node x.js', platforms: ['codex'] };

  it('accepts every entry in plugin.universal.mjs', () => {
    expect(() => validate(manifest.hooks)).not.toThrow();
  });

  it('rejects an invalid event', () => {
    expect(() => validate([{ ...good, event: 'NotAnEvent' }])).toThrow(/invalid event "NotAnEvent"/);
  });

  it('rejects a missing or empty command', () => {
    expect(() => validate([{ ...good, command: undefined }])).toThrow(/command must be a non-empty string/);
    expect(() => validate([{ ...good, command: '' }])).toThrow(/command must be a non-empty string/);
  });

  it('rejects unknown platforms and empty platform lists', () => {
    expect(() => validate([{ ...good, platforms: ['vscode'] }])).toThrow(/unknown platform "vscode"/);
    expect(() => validate([{ ...good, platforms: [] }])).toThrow(/platforms must be a non-empty array/);
  });

  it('rejects malformed matcher and async fields', () => {
    expect(() => validate([{ ...good, matcher: '' }])).toThrow(/matcher must be a non-empty string/);
    expect(() => validate([{ ...good, async: 'yes' }])).toThrow(/async must be a boolean/);
  });

  it('rejects an empty manifest', () => {
    expect(() => validate([])).toThrow(/non-empty array/);
  });

  it('build() throws before producing output when any entry is invalid', () => {
    const bad = { meta: manifest.meta, hooks: [good, { ...good, event: 'BadEvent' }] };
    expect(() => build(bad)).toThrow(/invalid event/);
  });

  it('every universal entry event is in VALID_EVENTS', () => {
    for (const e of manifest.hooks) expect(VALID_EVENTS.has(e.event)).toBe(true);
  });
});
