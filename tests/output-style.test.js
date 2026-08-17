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

// Verifies skills/output-style/SKILL.md (the install skill) and its slash-command
// wrapper. The skill is prose executed by the model, so these assertions are
// mechanical: frontmatter budget, the three named scopes, the stated default,
// the read-before-replace confirmation, the no-SessionStart-injection rule, and
// that the skill points at the shipped asset by the path it actually reads.

const SKILL_PATH = path.join(ROOT, 'skills', 'output-style', 'SKILL.md');
const COMMAND_PATH = path.join(ROOT, 'commands', 'output-style.md');

function readSkill() {
  return fs.readFileSync(SKILL_PATH, 'utf8');
}

function descriptionBytes(fm) {
  const lines = fm.split(/\r?\n/);
  const i = lines.findIndex((l) => /^description:/.test(l));
  if (i === -1) return 0;
  let v = lines[i].replace(/^description:\s*/, '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return Buffer.byteLength(v);
}

describe('skills/output-style/SKILL.md', () => {
  it('exists', () => {
    expect(fs.existsSync(SKILL_PATH)).toBe(true);
  });

  it('frontmatter lints clean: name present, description present and within the 300B budget', () => {
    const fm = parseFrontmatter(readSkill());
    expect(fm, 'no YAML frontmatter block found').not.toBeNull();
    expect(fm.name).toBeTruthy();
    expect(fm.description).toBeTruthy();
    const raw = readSkill().match(/^---\r?\n([\s\S]*?)\r?\n---/)[1];
    expect(descriptionBytes(raw)).toBeLessThanOrEqual(300);
  });

  it('names all three selection scopes: user-global, project, and project-local', () => {
    const src = readSkill();
    expect(src, 'user-global scope not named').toMatch(/user-global/i);
    expect(src, 'project scope not named').toMatch(/\.claude\/settings\.json/);
    expect(src, 'project-local scope not named').toMatch(/settings\.local\.json/);
  });

  it('states user-global as the default scope', () => {
    const src = readSkill();
    const idx = src.search(/user-global/i);
    expect(idx).toBeGreaterThan(-1);
    const nearby = src.slice(idx, idx + 200);
    expect(nearby).toMatch(/default/i);
  });

  it('requires reading the existing outputStyle and confirming before replacement', () => {
    const src = readSkill();
    expect(src, 'no instruction to read the existing settings file first').toMatch(
      /read (it|the existing settings file)|read.{0,30}before/i,
    );
    // A "confirm" word alone proves nothing — "nothing to confirm" on the
    // already-set branch would satisfy a bare word match while the actual
    // gate is gone. Require an interactive question with a decline path,
    // anchored to the branch where the existing value differs from Signal.
    const idx = src.search(/different value/i);
    expect(idx, 'no branch for an existing outputStyle holding a different value').toBeGreaterThan(-1);
    const nearby = src.slice(idx, idx + 800);
    expect(nearby, 'no interactive question posed before replacing a different value').toMatch(
      /AskUserQuestion/,
    );
    expect(nearby, 'no decline path offered alongside the replace confirmation').toMatch(
      /no,?\s*stop/i,
    );
  });

  it('nowhere instructs a SessionStart injection of the style', () => {
    const src = readSkill();
    // Every mention of SessionStart lives on a prose line (this skill has no
    // hard-wrapped paragraphs); requiring the SAME line to carry a prohibition
    // word rules out an instruction like "emit the style at SessionStart"
    // sitting on its own unqualified line.
    const lines = src.split(/\r?\n/).filter((l) => /SessionStart/.test(l));
    expect(lines.length, 'SessionStart not mentioned at all').toBeGreaterThan(0);
    for (const line of lines) {
      expect(line, `SessionStart mention not framed as a prohibition: "${line}"`).toMatch(
        /never|not\b|does not|no hook/i,
      );
    }
    // No hook-registration shape targeting SessionStart appears anywhere.
    expect(src).not.toMatch(/hooks\.SessionStart/);
    expect(src).not.toMatch(/"SessionStart"\s*:/);
  });

  it('references the shipped asset by the exact path it reads: output-styles/signal.md', () => {
    expect(readSkill()).toMatch(/output-styles\/signal\.md/);
  });

  it('installs the document to <configDir()>/output-styles/, not to a settings-only location', () => {
    const src = readSkill();
    expect(src).toMatch(/configDir\(\).*output-styles|output-styles.*configDir\(\)/s);
  });
});

describe('commands/output-style.md', () => {
  it('exists', () => {
    expect(fs.existsSync(COMMAND_PATH)).toBe(true);
  });

  it('points at the output-style skill', () => {
    const src = fs.readFileSync(COMMAND_PATH, 'utf8');
    expect(src).toMatch(/output-style/);
    expect(src).toMatch(/skill/i);
  });
});
