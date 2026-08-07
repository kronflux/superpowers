import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const toBash = (p) => p.split(path.sep).join('/');

const SYNC = path.join(REPO_ROOT, 'scripts', 'sync-to-antigravity.sh');
const PROFILE = path.join(REPO_ROOT, '.antigravity-plugin', '.agent');
const VALIDATOR = path.join(PROFILE, 'tests', 'check-antigravity-profile.sh');

function bash(scriptPath) {
  return execFileSync('bash', [toBash(scriptPath)], { encoding: 'utf8' });
}

function hashTree(root) {
  const files = [];
  (function walk(d) {
    for (const e of fs
      .readdirSync(d, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  })(root);
  const h = crypto.createHash('sha256');
  for (const f of files.sort()) {
    h.update(path.relative(root, f).split(path.sep).join('/'));
    h.update('\0');
    h.update(fs.readFileSync(f));
    h.update('\0');
  }
  return h.digest('hex');
}

describe('antigravity profile sync', () => {
  beforeAll(() => {
    bash(SYNC);
  });

  it('generates a profile the validator accepts (PROFILE OK)', () => {
    const out = bash(VALIDATOR);
    expect(out).toMatch(/PROFILE OK/);
  });

  it('is idempotent: two syncs produce a byte-identical tree', () => {
    const h1 = hashTree(PROFILE);
    bash(SYNC);
    const h2 = hashTree(PROFILE);
    expect(h2).toBe(h1);
  });

  it('validator fails loud on legacy-pattern leakage', () => {
    const tmp = fs.mkdtempSync(path.join(spTmpDir(), 'agy-profile-'));
    fs.cpSync(PROFILE, path.join(tmp, '.agent'), { recursive: true });
    const target = path.join(tmp, '.agent', 'skills', 'using-superpowers', 'SKILL.md');
    fs.appendFileSync(target, '\nTodoWrite\n');

    let failed = false;
    let output = '';
    try {
      execFileSync('bash', [toBash(path.join(tmp, '.agent', 'tests', 'check-antigravity-profile.sh'))], {
        encoding: 'utf8',
      });
    } catch (e) {
      failed = true;
      output = String(e.stderr || '') + String(e.stdout || '');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    expect(failed).toBe(true);
    expect(output).toMatch(/leakage|TodoWrite|PROFILE FAIL/);
  });

  it('validator fails loud when AGENTS.md loses a mapping keyword', () => {
    const tmp = fs.mkdtempSync(path.join(spTmpDir(), 'agy-agents-'));
    fs.cpSync(PROFILE, path.join(tmp, '.agent'), { recursive: true });
    const agents = path.join(tmp, '.agent', 'AGENTS.md');
    fs.writeFileSync(agents, fs.readFileSync(agents, 'utf8').replaceAll('view_file', 'viewfile'));

    let failed = false;
    let output = '';
    try {
      execFileSync('bash', [toBash(path.join(tmp, '.agent', 'tests', 'check-antigravity-profile.sh'))], {
        encoding: 'utf8',
      });
    } catch (e) {
      failed = true;
      output = String(e.stderr || '') + String(e.stdout || '');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    expect(failed).toBe(true);
    expect(output).toMatch(/view_file/);
  });
});
