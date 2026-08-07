import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT_NAME, spTmpDir, spTmp } from '../hooks/lib/sp-tmp.js';

describe('sp-tmp', () => {
  it('roots everything at <tmpdir>/sp and creates it', () => {
    const dir = spTmpDir();
    expect(dir).toBe(path.join(os.tmpdir(), ROOT_NAME));
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
  });

  it('is idempotent', () => {
    expect(() => { spTmpDir(); spTmpDir(); }).not.toThrow();
  });

  it('builds paths inside the root', () => {
    expect(spTmp('usage-abc')).toBe(path.join(os.tmpdir(), ROOT_NAME, 'usage-abc'));
    expect(spTmp('stop-abc.lock')).toBe(path.join(os.tmpdir(), ROOT_NAME, 'stop-abc.lock'));
  });

  it('still returns a path when the directory cannot be created', () => {
    // Hooks fail open: a caller must always get a path back and let its own
    // guarded write fail, rather than the helper throwing inside a hook.
    const realMkdir = fs.mkdirSync;
    fs.mkdirSync = () => { throw new Error('EACCES'); };
    try {
      expect(spTmp('x')).toBe(path.join(os.tmpdir(), ROOT_NAME, 'x'));
    } finally {
      fs.mkdirSync = realMkdir;
    }
  });

  it('confines a traversal payload inside the root', () => {
    // Assert containment structurally (resolved-path prefix check), not by
    // string-matching the sanitized name — that would only restate the
    // implementation instead of proving the escape is closed.
    const root = path.resolve(spTmpDir());
    const escaped = path.resolve(spTmp('../../../../../../../../etc/passwd'));
    expect(escaped.startsWith(root + path.sep)).toBe(true);
  });

  it('leaves an ordinary name unchanged', () => {
    expect(spTmp('conductor-abc-123.def_ghi')).toBe(
      path.join(os.tmpdir(), ROOT_NAME, 'conductor-abc-123.def_ghi')
    );
  });
});
