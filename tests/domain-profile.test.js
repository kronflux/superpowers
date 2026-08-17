import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRECONDITIONS,
  loadDomainProfile,
  skillDeclaredPreconditions,
  hasUnmetPrecondition,
} from '../hooks/lib/domain-profile.js';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';

// Task 4 (skill-semantics-routing): a skill declares preconditions in its
// frontmatter; a repository declares which hold in
// `.superpowers/domain-profile.json`. This suite covers the profile-loading
// half in isolation from the hint-filter and routing-prose halves covered
// elsewhere.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function withScratch(fn) {
  const scratch = fs.mkdtempSync(path.join(spTmpDir(), 'sp-domain-profile-'));
  try {
    return fn(scratch);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function writeProfile(scratch, content) {
  const dir = path.join(scratch, '.superpowers');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'domain-profile.json'), content);
}

describe('loadDomainProfile', () => {
  it('an absent domain-profile.json means all three preconditions hold', () => {
    withScratch((scratch) => {
      const profile = loadDomainProfile(scratch);
      for (const key of PRECONDITIONS) expect(profile[key]).toBe(true);
    });
  });

  it('a profile declaring execution-safe: false marks only that precondition unmet', () => {
    withScratch((scratch) => {
      writeProfile(scratch, JSON.stringify({ 'execution-safe': false }));
      const profile = loadDomainProfile(scratch);
      expect(profile['execution-safe']).toBe(false);
      expect(profile['artifact-cheap-to-modify']).toBe(true);
      expect(profile['failure-is-cheap']).toBe(true);
    });
  });

  it('a malformed profile means all three hold and never throws', () => {
    withScratch((scratch) => {
      writeProfile(scratch, '{not valid json');
      expect(() => loadDomainProfile(scratch)).not.toThrow();
      const profile = loadDomainProfile(scratch);
      for (const key of PRECONDITIONS) expect(profile[key]).toBe(true);
    });
  });

  it('a profile that is valid JSON but not an object means all three hold', () => {
    withScratch((scratch) => {
      writeProfile(scratch, JSON.stringify(['execution-safe']));
      const profile = loadDomainProfile(scratch);
      for (const key of PRECONDITIONS) expect(profile[key]).toBe(true);
    });
  });
});

describe('skillDeclaredPreconditions', () => {
  it('test-driven-development and systematic-debugging both declare execution-safe and failure-is-cheap', () => {
    const skillsRoot = path.join(ROOT, 'skills');
    for (const name of ['test-driven-development', 'systematic-debugging']) {
      const declared = skillDeclaredPreconditions(skillsRoot, name);
      expect(declared).toContain('execution-safe');
      expect(declared).toContain('failure-is-cheap');
    }
  });

  it('returns [] for a skill with no preconditions key', () => {
    const skillsRoot = path.join(ROOT, 'skills');
    expect(skillDeclaredPreconditions(skillsRoot, 'brainstorming')).toEqual([]);
  });

  it('returns [] for a nonexistent skill and never throws', () => {
    const skillsRoot = path.join(ROOT, 'skills');
    expect(() => skillDeclaredPreconditions(skillsRoot, 'no-such-skill')).not.toThrow();
    expect(skillDeclaredPreconditions(skillsRoot, 'no-such-skill')).toEqual([]);
  });
});

describe('hasUnmetPrecondition', () => {
  it('true when a declared precondition is false in the profile', () => {
    expect(hasUnmetPrecondition(['execution-safe'], { 'execution-safe': false })).toBe(true);
  });

  it('false when every declared precondition holds', () => {
    expect(hasUnmetPrecondition(['execution-safe', 'failure-is-cheap'], {
      'execution-safe': true,
      'failure-is-cheap': true,
    })).toBe(false);
  });

  it('false for a skill declaring no preconditions, regardless of the profile', () => {
    expect(hasUnmetPrecondition([], { 'execution-safe': false })).toBe(false);
  });
});
