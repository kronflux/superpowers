import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { checkCommand, checkAsk, isBulkAdd } from '../hooks/safety/block-dangerous-commands.js';
import { check, isAllowlisted } from '../hooks/safety/protect-secrets.js';
import { resolveSkillPath, stripFrontmatter } from '../hooks/lib/skills-core.js';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLOCK_DANGEROUS_HOOK = path.resolve(__dirname, '../hooks/safety/block-dangerous-commands.js');

function runHook(payload) {
  const tmpHome = fs.mkdtempSync(path.join(spTmpDir(), 'safety-hooks-'));
  try {
    const res = spawnSync('node', [BLOCK_DANGEROUS_HOOK], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome },
    });
    return JSON.parse(res.stdout || '{}');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
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
    'git add .\ngit status',
    'cd foo && git add .\nnpm test',
  ];
  const allows = [
    'git add path/to/file.js',
    'git add -p src/main.js',
    'git add README.md docs/notes.md',
    'git commit -m "feat: x"',
    'git commit --amend --no-edit',
    'git status',
    'git add ./src',
    'git add ./src\nnpm test',
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

const REPO = '/home/richard/creality-re';

// Drawn from 58 real ASK events in the operator's hooks-logs. Each entry is a
// class observed in that corpus, not a hand-invented case.
const MUST_ASK = [
  'git add -A',
  'git add --all',
  'git add -A .',
  'git add -A ./',
  'git add -A *',
  `git add -A ${REPO}`,
  'git add .',
  'git commit -a -m x',
  'git commit -am x',
  'git commit --all -m x',
  'git add -A && git commit -q -m x',
  'cd /repo\ngit add --all',
  'echo hi\ngit add -A',
  'git add --all\necho done',
  'sleep 5 & git add -A',
  'npm start & git add --all',
  'git add -A & echo done',
];

// A command prefix — a wrapper, a shell keyword left at the head of a
// segment after `;` splitting — sits before `git` and must not hide it.
const MUST_ASK_PREFIXED = [
  'sudo git add -A',
  'env FOO=1 git add -A',
  'if true; then git add -A; fi',
  'for f in x; do git add -A; done',
  'while read l; do git commit -am x; done',
];

const MUST_NOT_ASK = [
  'git add -A reconstruction/prtouch_v3_wrapper/',
  'git add -A audit/BUG-PT-BMC-NOPROBE.md tests/bineq/test_pic_sites.py',
  'git add -A tools/bineq/func_locate.py',
  'git add -A audit/BUG-PT-BMC-NOPROBE.md 2>/dev/null',
  'git add -A virtual_printer 2>/dev/null && git commit -q -F tools/scripts/_tmp_msg5.txt',
  'git add src/foo.js && ls -a',
  'git add reconstruction/mymovie/mymovie.pyx reconstruction/mymovie/mymovie.c',
  'git commit -m "x" && git push --all',
  'git status --porcelain',
  "git add -A f.py && git commit -q -F - <<'EOF' body mentioning git add --all",
  // Prove a command prefix does not also suppress the pathspec scoping rule.
  'sudo git add -A src/foo.js',
  'if true; then git add -A src/; fi',
];

describe('checkAsk segment precision', () => {
  for (const cmd of MUST_ASK) {
    it(`asks: ${cmd}`, () => {
      expect(checkAsk(cmd, { repoRoot: REPO }).ask).toBe(true);
    });
  }
  for (const cmd of MUST_ASK_PREFIXED) {
    it(`asks: ${cmd}`, () => {
      expect(checkAsk(cmd, { repoRoot: REPO }).ask).toBe(true);
    });
  }
  for (const cmd of MUST_NOT_ASK) {
    it(`does not ask: ${cmd}`, () => {
      expect(checkAsk(cmd, { repoRoot: REPO }).ask).toBe(false);
    });
  }
});

describe('isBulkAdd', () => {
  it('is true for a bare -A', () => {
    expect(isBulkAdd('git add -A', REPO)).toBe(true);
  });
  it('is false when a pathspec follows -A', () => {
    expect(isBulkAdd('git add -A src/', REPO)).toBe(false);
  });
  it('is true when the only pathspec resolves to the repo root', () => {
    expect(isBulkAdd('git add -A .', REPO)).toBe(true);
  });
  it('ignores a redirect when reading pathspecs', () => {
    expect(isBulkAdd('git add -A 2>/dev/null', REPO)).toBe(true);
  });
  it('is false without -A or --all', () => {
    expect(isBulkAdd('git add src/a.js', REPO)).toBe(false);
  });
});
