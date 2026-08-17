// Repository-level precondition declarations.
//
// A skill's frontmatter may declare `preconditions:` — a subset of the
// closed vocabulary in PRECONDITIONS — naming what it assumes about the
// codebase it runs against. A repository states which of those hold in
// `.superpowers/domain-profile.json`. An absent or unreadable file means
// every precondition holds, matching the status quo for a repository that
// has never declared a profile.
import fs from 'node:fs';
import path from 'node:path';

const PRECONDITIONS = ['artifact-cheap-to-modify', 'execution-safe', 'failure-is-cheap'];

/**
 * Reads `.superpowers/domain-profile.json` under `cwd`. Only an explicit
 * `false` for a known key marks that precondition unmet; a missing file, an
 * unreadable file, malformed JSON, or a non-object value all fall back to
 * every precondition holding. Never throws.
 */
function loadDomainProfile(cwd) {
  const profile = {};
  for (const key of PRECONDITIONS) profile[key] = true;

  let raw;
  try {
    raw = fs.readFileSync(path.join(cwd, '.superpowers', 'domain-profile.json'), 'utf8');
  } catch {
    return profile;
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const key of PRECONDITIONS) {
        if (parsed[key] === false) profile[key] = false;
      }
    }
  } catch {
    // Malformed JSON: keep the all-true default.
  }
  return profile;
}

/**
 * Reads the `preconditions:` list from a skill's SKILL.md frontmatter.
 * Returns [] when the skill has no such key, its file is unreadable, or its
 * frontmatter is absent — never throws.
 */
function skillDeclaredPreconditions(skillsRoot, skillName) {
  let src;
  try {
    src = fs.readFileSync(path.join(skillsRoot, skillName, 'SKILL.md'), 'utf8');
  } catch {
    return [];
  }
  const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return [];
  const lines = fm[1].split(/\r?\n/);
  const i = lines.findIndex((l) => /^preconditions:/.test(l));
  if (i === -1) return [];
  const values = [];
  for (let j = i + 1; j < lines.length; j++) {
    const m = lines[j].match(/^\s*-\s*(.+?)\s*$/);
    if (!m) break;
    values.push(m[1].trim());
  }
  return values;
}

/** True when any of `preconditions` is declared `false` in `profile`. */
function hasUnmetPrecondition(preconditions, profile) {
  return preconditions.some((p) => profile[p] === false);
}

export { PRECONDITIONS, loadDomainProfile, skillDeclaredPreconditions, hasUnmetPrecondition };
