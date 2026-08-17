import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SDD = path.join(ROOT, 'skills', 'subagent-driven-development');
const SKILL = path.join(SDD, 'SKILL.md');
const OPS = path.join(SDD, 'references', 'controller-operations.md');
const EXECUTING_PLANS = path.join(ROOT, 'skills', 'executing-plans', 'SKILL.md');

const read = (p) => fs.readFileSync(p, 'utf8');

// Returns the heading line plus body of the first heading matching `re`, ending
// at the next heading of the same or shallower level.
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

function sentences(text) {
  return text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.:;])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Any wording that disposes of a case by creating no task.
const NO_CREATION = /\b(creates? nothing|create nothing|creates? no |nothing is created|no tasks? (are|is) created|does not (create|recreate)|never (create|recreate))/i;

// The cases the restore step must dispose of. Owned by this test, not by the
// prose: the document has to answer each one, however it words the answer.
const PRECONDITIONS = [
  ['the tasks file is absent', /\.tasks\.json/i, /\b(no|without|absent|missing|does not exist)\b/i],
  ['no plan is under execution', /\bplan\b/i, /\b(no|without|outside)\b/i],
  ['the tasks already exist', /\b(task|tasks)\b/i, /\b(already|existing|duplicat)/i],
];

describe('SDD task-list restore', () => {
  it('restores with the mechanism executing-plans already owns, not a second one', () => {
    const step0 = section(read(EXECUTING_PLANS), /Load Persisted Tasks/);
    expect(step0, 'executing-plans no longer defines the restore step').not.toBeNull();

    const tools = [...new Set(step0.match(/\bTask(?:List|Create|Update)\b/g) || [])];
    expect(tools.length, 'executing-plans Step 0 names no task tools').toBeGreaterThan(1);

    const sdd = `${read(SKILL)}\n${read(OPS)}`;
    for (const tool of tools) {
      expect(sdd, `subagent-driven-development never calls ${tool}`).toContain(tool);
    }
    expect(sdd, 'subagent-driven-development never names the tasks file').toMatch(/\.tasks\.json/);
  });

  it('cites the executing-plans procedure at a path that resolves', () => {
    const ops = read(OPS);
    const link = ops.match(/\]\(([^)]*executing-plans\/SKILL\.md[^)]*)\)/);
    expect(link, 'controller-operations.md never cites the executing-plans restore step').not.toBeNull();
    const target = path.resolve(path.dirname(OPS), link[1].split('#')[0]);
    expect(fs.existsSync(target), `cited path does not resolve: ${link[1]}`).toBe(true);
  });

  it('disposes of every precondition under which no task may be created', () => {
    const restore = section(read(OPS), /Restor/i);
    expect(restore, 'controller-operations.md has no restore section').not.toBeNull();
    expect(restore, 'the restore section never calls TaskCreate').toMatch(/TaskCreate/);

    const lines = sentences(restore);
    for (const [name, subject, absence] of PRECONDITIONS) {
      const answered = lines.some(
        (s) => subject.test(s) && absence.test(s) && NO_CREATION.test(s),
      );
      expect(answered, `the restore step never says what happens when ${name}`).toBe(true);
    }
  });

  it('states the rebuild as tracking work, with no appeal to reminder behaviour', () => {
    // The list exists because the work is real. A rebuild argued from the
    // harness's reminder interval would be suppression wearing the shape of
    // tracking, and would break the moment that interval moved.
    const text = `${read(SKILL)}\n${read(OPS)}`;
    expect(text).not.toMatch(/task_reminder|\bnag\b|assistant messages|turns? since|reminder (interval|threshold)/i);
  });
});
