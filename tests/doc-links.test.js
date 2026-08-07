import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Scope is deliberately narrow. docs/superpowers/** and docs/plans/** are a
// committed archive of past design work; they reference files that were later
// renamed or deleted on purpose, and rewriting history to satisfy a linter
// would be worse than the dangling link.
const SCOPES = [
  path.join(ROOT, 'skills'),
  path.join(ROOT, 'docs', 'adr'),
];
const ROOT_DOCS = ['ARCHITECTURE.md'].map((f) => path.join(ROOT, 'docs', f));

// anthropic-best-practices.md is a reproduction of Anthropic's own skill-authoring
// tutorial; its "FORMS.md" / "reference.md" / "advanced.md" links are illustrative
// example file trees, not real paths in this repo. Excluded rather than fixed.
const EXCLUDE_FILES = [
  path.join(ROOT, 'skills', 'writing-skills', 'anthropic-best-practices.md'),
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const LINK_RE = /\[[^\]]*\]\(([^)\s]+)/g;

describe('doc links', () => {
  it('every relative .md link in skills/ and docs/adr resolves', () => {
    const files = [...SCOPES.flatMap((d) => walk(d)), ...ROOT_DOCS.filter(fs.existsSync)]
      .filter((f) => !EXCLUDE_FILES.includes(f));
    const broken = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(LINK_RE)) {
        const target = m[1].split('#')[0].trim();
        if (!target || /^(https?:|mailto:|#)/.test(target)) continue;
        if (!target.endsWith('.md')) continue;
        if (!fs.existsSync(path.resolve(path.dirname(file), target))) {
          broken.push(`${path.relative(ROOT, file)} -> ${target}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});
