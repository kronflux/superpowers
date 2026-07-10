import { describe, it, expect } from 'vitest';
import { checkCommand } from '../hooks/safety/block-dangerous-commands.js';
import { check, isAllowlisted } from '../hooks/safety/protect-secrets.js';
import { resolveSkillPath, stripFrontmatter } from '../hooks/lib/skills-core.js';

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
