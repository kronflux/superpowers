import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Verifies the shipped output style asset (output-styles/signal.md) against
// the four amendments required before it ships: an exhaustive-result
// exception to the five-item cap, an interview-shaped-skill carve-out for
// clarifying questions, a skill-mandated option-set exception to the
// single-recommendation rule, and a structured-return carve-out. Assertions
// target the concepts and named skills/result-types, not exact wording, so
// the source prose can be edited without invalidating the suite.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STYLE_PATH = path.join(ROOT, 'output-styles', 'signal.md');

function readStyle() {
  return fs.readFileSync(STYLE_PATH, 'utf8');
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim();
  }
  return fm;
}

const INTERVIEW_SKILLS = [
  'brainstorming',
  'deliberation',
  'specifying-gates',
  'statusline',
  'onboard',
];

describe('output-styles/signal.md', () => {
  it('exists', () => {
    expect(fs.existsSync(STYLE_PATH)).toBe(true);
  });

  it('frontmatter parses and carries name, description, keep-coding-instructions: true', () => {
    const fm = parseFrontmatter(readStyle());
    expect(fm, 'no YAML frontmatter block found').not.toBeNull();
    expect(fm.name).toBeTruthy();
    expect(fm.description).toBeTruthy();
    expect(fm['keep-coding-instructions']).toBe('true');
  });

  it('amendment 1: the five-item cap names an exhaustive-result exception covering review findings and test failures', () => {
    const content = readStyle();
    const capIdx = content.search(/cap lists at five/i);
    expect(capIdx, 'five-item cap rule not found').toBeGreaterThan(-1);
    // The exception must live at or after the cap statement, within the same section.
    const nearby = content.slice(capIdx, capIdx + 600);
    expect(nearby).toMatch(/review findings?/i);
    expect(nearby).toMatch(/test failures?/i);
    expect(nearby).toMatch(/audit/i);
    expect(nearby).toMatch(/exception|except|uncapped|not capped|never cap/i);
  });

  it('amendment 2: the clarifying-questions rule carves out all five interview-shaped skills by name', () => {
    const content = readStyle();
    const idx = content.search(/clarifying questions/i);
    expect(idx, 'clarifying-questions rule not found').toBeGreaterThan(-1);
    const nearby = content.slice(idx, idx + 600);
    for (const skill of INTERVIEW_SKILLS) {
      expect(nearby, `interview skill "${skill}" not named near the clarifying-questions rule`).toContain(skill);
    }
  });

  it('amendment 3: the single-recommendation rule excepts skill-mandated option sets', () => {
    const content = readStyle();
    const idx = content.search(/recommend one path/i);
    expect(idx, 'single-recommendation rule not found').toBeGreaterThan(-1);
    const nearby = content.slice(idx, idx + 500);
    expect(nearby).toMatch(/only when asked to compare/i);
    expect(nearby).toMatch(/skill|mandate|brainstorming/i);
  });

  it('amendment 4: a structured-return carve-out exists for controller-consumed output', () => {
    const content = readStyle();
    expect(content).toMatch(/structured return/i);
    expect(content).toMatch(/schema/i);
    expect(content).toMatch(/controller|subagent/i);
  });

  it('ships exactly one style: no ASD-STE100, ADHD or ELI5 preset sections', () => {
    const content = readStyle();
    // ASD-STE100 as a *methodology reference* inside the single shipped style is fine;
    // what must not exist is a dedicated preset/variant section for any of the three.
    const headingLines = content
      .split(/\r?\n/)
      .filter((line) => /^#{1,3}\s/.test(line));
    for (const heading of headingLines) {
      expect(heading).not.toMatch(/ASD-?STE ?100/i);
      expect(heading).not.toMatch(/ADHD/i);
      expect(heading).not.toMatch(/ELI5/i);
    }
    expect(content).not.toMatch(/ADHD-summary/i);
    expect(content).not.toMatch(/ELI5/i);
  });
});
