import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Structural test only. The statusline skill is model-executed prose, not code —
// there is nothing here to unit-test behaviourally. This asserts the artifact
// exists, its frontmatter parses within budget, and its body actually instructs
// the four segment ids, the four distinct gitignore outcomes, and the
// unparseable-settings refusal rather than collapsing any of them into one
// vague sentence.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SKILL_PATH = path.join(ROOT, 'skills', 'statusline', 'SKILL.md');

const SEGMENT_IDS = ['capabilities', 'delegation', 'plan', 'usage'];
const GITIGNORE_STATES = ['already', 'added', 'tracked', 'unknown'];

function readSkill() {
  return fs.readFileSync(SKILL_PATH, 'utf8');
}

function frontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : null;
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

describe('skills/statusline/SKILL.md', () => {
  it('exists', () => {
    expect(fs.existsSync(SKILL_PATH)).toBe(true);
  });

  it('has YAML frontmatter with name and description', () => {
    const fm = frontmatter(readSkill());
    expect(fm).not.toBeNull();
    expect(fm).toMatch(/\bname:\s*\S+/);
    expect(fm).toMatch(/\bdescription:/);
  });

  it('description is within the 300-byte budget', () => {
    const fm = frontmatter(readSkill());
    expect(descriptionBytes(fm)).toBeLessThanOrEqual(300);
  });

  it('SKILL.md core is within the 12,288-byte budget', () => {
    expect(Buffer.byteLength(readSkill())).toBeLessThanOrEqual(12288);
  });

  it('names all four segment ids', () => {
    const src = readSkill();
    for (const id of SEGMENT_IDS) {
      expect(src, `missing segment id "${id}"`).toContain(id);
    }
  });

  it('instructs the widget-vs-full mode choice', () => {
    const src = readSkill();
    expect(src).toMatch(/widget/i);
    expect(src).toMatch(/--full|standalone/i);
  });

  it('instructs a separator choice', () => {
    expect(readSkill()).toMatch(/separator/i);
  });

  it('names all four gitignore states distinctly, each with its own explanation', () => {
    const src = readSkill();
    for (const state of GITIGNORE_STATES) {
      // Each state must appear as its own backtick-quoted term, not just
      // buried in prose — this is what proves the four are kept distinct
      // rather than collapsed into one generic gitignore paragraph.
      expect(src, `missing distinct gitignore state "${state}"`).toMatch(
        new RegExp('`' + state + '`'),
      );
    }
  });

  it('the unknown gitignore state is reported as inconclusive, not as success or as tracked', () => {
    const src = readSkill();
    const idx = src.indexOf('`unknown`');
    expect(idx).toBeGreaterThan(-1);
    const section = src.slice(idx, idx + 500);
    expect(section).toMatch(/inconclusive/i);
    expect(section).toMatch(/no rule was written|nothing.{0,20}written/i);
  });

  it('names the unparseable settings.json outcome and stops the install rather than continuing', () => {
    const src = readSkill();
    const idx = src.indexOf('unparseable');
    expect(idx).toBeGreaterThan(-1);
    // Normalize whitespace (prose is hard-wrapped at ~90 cols, so a phrase can
    // legitimately span a newline) before matching multi-word phrases.
    const section = src.slice(idx, idx + 800).replace(/\s+/g, ' ');
    // Must instruct: stop, do not retry, do not offer to rewrite, name the file path.
    expect(section).toMatch(/stop/i);
    expect(section).toMatch(/do not retry/i);
    expect(section).toMatch(/do not offer to rewrite|do not .{0,20}repair/i);
    expect(section).toMatch(/settings\.json/);
  });

  it('the tracked state offers git rm --cached without instructing it be run automatically', () => {
    const src = readSkill();
    const trackedIdx = src.indexOf('`tracked`');
    expect(trackedIdx).toBeGreaterThan(-1);
    const trackedSection = src.slice(trackedIdx, trackedIdx + 600);
    expect(trackedSection).toMatch(/git rm --cached -r \.claude/);
    expect(trackedSection).toMatch(/never run it yourself|their own terminal|user's decision/i);
  });

  it('references the four install actions: config write, launcher install, settings patch, gitignore', () => {
    const src = readSkill();
    expect(src).toMatch(/statusline\.json/);
    expect(src).toMatch(/installLauncher/);
    expect(src).toMatch(/patchSettings/);
    expect(src).toMatch(/ensureGitignored/);
  });

  it('states it re-reads existing config on re-run instead of starting blank', () => {
    const src = readSkill();
    expect(src).toMatch(/re-run/i);
    expect(src).toMatch(/amend/i);
  });

  it('states it does not install or configure ccstatusline itself', () => {
    const src = readSkill();
    expect(src).toMatch(/does not install|not install.{0,40}ccstatusline|do not install.{0,40}ccstatusline/i);
  });
});
