import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { checkCommand } from '../hooks/safety/block-dangerous-commands.js';
import { check, isAllowlisted } from '../hooks/safety/protect-secrets.js';
import { resolveSkillPath, stripFrontmatter } from '../hooks/lib/skills-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLOCK_DANGEROUS_HOOK = path.resolve(__dirname, '../hooks/safety/block-dangerous-commands.js');

function runHook(payload) {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-safety-hooks-'));
  const res = spawnSync('node', [BLOCK_DANGEROUS_HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome },
  });
  return JSON.parse(res.stdout || '{}');
}

describe('block-dangerous-commands', () => {
  it('denies a known-dangerous command', () => {
    const r = checkCommand('rm -rf ~/');
    expect(r.blocked).toBe(true);
    expect(r.pattern.id).toBe('rm-home');
  });

  it('allows a safe command', () => {
    expect(checkCommand('ls -la').blocked).toBe(false);
  });
});

describe('protect-secrets', () => {
  it('blocks reading a sensitive file', () => {
    const r = check('Read', { file_path: '.env' });
    expect(r.blocked).toBe(true);
    expect(r.pattern.id).toBe('env-file');
  });

  it('allows an allowlisted example file', () => {
    expect(isAllowlisted('.env.example')).toBe(true);
    expect(check('Read', { file_path: '.env.example' }).blocked).toBe(false);
  });

  it('blocks hardcoded secrets in Write content', () => {
    const r = check('Write', { file_path: 'config.js', content: 'const k = "AKIAIOSFODNN7EXAMPLE";' });
    expect(r.blocked).toBe(true);
    expect(r.pattern.id).toBe('hardcoded-aws-access-key');
  });

  it('blocks a secret-exfil bash command', () => {
    expect(check('Bash', { command: 'cat .env' }).blocked).toBe(true);
  });
});

describe('skills-core', () => {
  it('resolveSkillPath honors superpowers: prefix and returns null for unknown', () => {
    expect(resolveSkillPath('superpowers:nope', '/nonexistent', null)).toBeNull();
  });

  it('stripFrontmatter removes YAML frontmatter', () => {
    const out = stripFrontmatter('---\nname: x\n---\nbody');
    expect(out).toBe('body');
  });
});

describe('bulk-staging ask patterns', () => {
  const asks = [
    'git add -A',
    'git add --all',
    'git add .',
    'git add ./',
    'git add . && git commit -m "x"',
    'git commit -a -m "x"',
    'git commit -am "x"',
    'git commit --all -m "x"',
  ];
  const allows = [
    'git add path/to/file.js',
    'git add -p src/main.js',
    'git add README.md docs/notes.md',
    'git commit -m "feat: x"',
    'git commit --amend --no-edit',
    'git status',
  ];
  for (const cmd of asks) {
    it(`asks on: ${cmd}`, () => {
      const out = runHook({ tool_name: 'Bash', tool_input: { command: cmd } });
      expect(out.hookSpecificOutput?.permissionDecision).toBe('ask');
      expect(out.hookSpecificOutput?.permissionDecisionReason).toMatch(/explicit paths/);
    });
  }
  for (const cmd of allows) {
    it(`passes: ${cmd}`, () => {
      const out = runHook({ tool_name: 'Bash', tool_input: { command: cmd } });
      expect(out).toEqual({});
    });
  }
  it('deny still wins over ask', () => {
    const out = runHook({ tool_name: 'Bash', tool_input: { command: 'git add . && git reset --hard' } });
    expect(out.hookSpecificOutput?.permissionDecision).toBe('deny');
  });
});
