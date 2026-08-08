import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyComment, extractComments } from '../hooks/lib/comment-patterns.js';
import { spTmp } from '../hooks/lib/sp-tmp.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Source directories this repo owns and enforces the rule against. docs/,
// RELEASE-NOTES.md, and .superpowers/ hold prose that legitimately discusses
// development history; .antigravity-plugin/ is a generated overlay.
const SCAN_DIRS = ['hooks', 'scripts', 'tests', 'skills'];
const SCAN_EXT = /\.(js|mjs|sh)$/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (SCAN_EXT.test(entry.name)) out.push(p);
  }
  return out;
}

// Classifies each comment on its own line, so a violation is reported
// against the line it was written on rather than the file as a whole.
function lintFile(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const violations = [];
  lines.forEach((line, i) => {
    for (const body of extractComments(line)) {
      const result = classifyComment(body);
      if (result) {
        violations.push({ file: filePath, line: i + 1, violation: result.violation, match: result.match });
      }
    }
  });
  return violations;
}

// Pre-existing matches outside this task's authorized file set, kept out of
// the failing set with a stated reason rather than silently dropped. Any
// other match, including a new one in these same files, still fails.
const KNOWN_EXEMPTIONS = [
  {
    file: path.join('hooks', 'examples', 'stop-deflection-guard.sh'), line: 90,
    // Cites a real upstream bug number backing a permanent workaround, not
    // a deferred-work ticket reference.
    reason: 'external-bug citation for a shipped workaround, not deferred work',
  },
  {
    file: path.join('scripts', 'package-codex-plugin.sh'), line: 7,
    reason: 'pre-existing, outside this change\'s authorized file set',
  },
  {
    file: path.join('tests', 'session-end-cleanup.test.js'), line: 45,
    reason: 'pre-existing, outside this change\'s authorized file set',
  },
];

function isExempt(v) {
  const rel = path.relative(ROOT, v.file);
  return KNOWN_EXEMPTIONS.some((e) => e.file === rel && e.line === v.line);
}

function scanRepo() {
  return SCAN_DIRS
    .flatMap((d) => walk(path.join(ROOT, d)))
    .flatMap((f) => lintFile(f))
    .filter((v) => !isExempt(v));
}

describe('lint-comments: repo source', () => {
  it('is silent on narration and impermanence across hooks/, scripts/, tests/, skills/', () => {
    const violations = scanRepo();
    const report = violations
      .map((v) => `${path.relative(ROOT, v.file)}:${v.line}: [${v.violation}] "${v.match}"`)
      .join('\n');
    expect(violations, report).toEqual([]);
  });
});

describe('lint-comments: detection', () => {
  it('flags a seeded violation in a temp file', () => {
    const tmpFile = spTmp('lint-comments-seed.js');
    fs.writeFileSync(tmpFile, [
      '// TODO: this is a temporary hack for now',
      'const x = 1;',
      '',
    ].join('\n'));
    try {
      const violations = lintFile(tmpFile);
      expect(violations).toEqual([
        { file: tmpFile, line: 1, violation: 'impermanence', match: 'TODO' },
      ]);
    } finally {
      fs.rmSync(tmpFile, { force: true });
    }
  });

  it('reports no violations for a clean temp file', () => {
    const tmpFile = spTmp('lint-comments-clean.js');
    fs.writeFileSync(tmpFile, [
      '// Returns the sum of two numbers',
      'function add(a, b) { return a + b; }',
      '',
    ].join('\n'));
    try {
      expect(lintFile(tmpFile)).toEqual([]);
    } finally {
      fs.rmSync(tmpFile, { force: true });
    }
  });
});
