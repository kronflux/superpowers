import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SDD = path.join(ROOT, 'skills', 'subagent-driven-development');
const SKILL = path.join(SDD, 'SKILL.md');
const OPS = path.join(SDD, 'references', 'controller-operations.md');

const read = (p) => fs.readFileSync(p, 'utf8');

function section(text, re) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^#{2,4} /.test(l) && re.test(l));
  if (start === -1) return null;
  const level = lines[start].match(/^(#+)/)[1].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= level) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

// The per-task loop as SKILL.md draws it. Every state the transitions claim must
// be a state this graph passes through.
function processGraph() {
  const m = read(SKILL).match(/```dot\ndigraph process \{([\s\S]*?)```/);
  expect(m, 'SKILL.md no longer draws the per-task process graph').not.toBeNull();
  return m[1];
}

const stems = (text) =>
  new Set((text.toLowerCase().match(/[a-z]{6,}/g) || []).map((w) => w.slice(0, 6)));

function tableRows(md) {
  return md
    .split('\n')
    .filter((l) => l.trim().startsWith('|') && !/^\s*\|[\s:|-]+\|\s*$/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .filter((cells) => cells.length >= 2)
    .slice(1);
}

describe('SDD task-body transitions', () => {
  it('names transitions the drawn loop actually passes through', () => {
    const transitions = section(read(OPS), /Transition/i);
    expect(transitions, 'controller-operations.md has no task-transition section').not.toBeNull();

    const rows = tableRows(transitions);
    expect(rows.length, 'no transitions are listed').toBeGreaterThanOrEqual(3);

    const graph = stems(processGraph());
    for (const [event] of rows) {
      const matched = [...stems(event)].some((s) => graph.has(s));
      expect(matched, `"${event}" names no state the process graph contains`).toBe(true);
    }
  });

  it('records each transition through TaskUpdate', () => {
    const transitions = section(read(OPS), /Transition/i);
    expect(transitions).toMatch(/TaskUpdate/);
    // activeForm is the field whose meaning is "what is happening right now";
    // status stays in_progress across the whole task body.
    expect(transitions, 'the transitions carry no field that changes').toMatch(/activeForm/);
    for (const [, value] of tableRows(transitions)) {
      expect(value, 'a transition row records no new state').not.toBe('');
    }
  });

  it('forbids an update with no real state change, as a binding Never', () => {
    const redFlags = section(read(SKILL), /Red Flags/i);
    expect(redFlags, 'SKILL.md has no Red Flags section').not.toBeNull();
    const never = redFlags.split(/\*\*If /)[0];
    const bullet = never
      .split('\n')
      .find((l) => /^-\s/.test(l.trim()) && /no real state change/i.test(l));
    expect(bullet, 'no Never bullet forbids an update with no real state change')
      .toBeTruthy();
    expect(bullet).toMatch(/TaskUpdate/);
  });

  it('leaves a genuinely atomic long step alone rather than papering over it', () => {
    const transitions = section(read(OPS), /Transition/i);
    const answered = transitions
      .replace(/\n+/g, ' ')
      .split(/(?<=[.:;])\s+/)
      .some((s) => /\batomic\b|\bsingle step\b|\bone step\b/i.test(s)
        && /no update|gets none|silence|says nothing|without an update/i.test(s));
    expect(answered, 'the section never says what a long atomic step does').toBe(true);
  });

  it('states no threshold and no reminder interval', () => {
    const text = `${read(SKILL)}\n${read(OPS)}`;
    expect(text).not.toMatch(/\b10\b[^.\n]*(message|turn|update)|(message|turn|update)[^.\n]*\b10\b/i);
    expect(text).not.toMatch(/task_reminder|\bnag\b|reminder (interval|threshold)/i);
  });
});
