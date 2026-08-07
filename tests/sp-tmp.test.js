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

  // A sanitized name that is exactly '.', '..', or '' is a directory
  // reference the char filter alone can't neutralize — path.join(root, '..')
  // walks out one level even though '..' itself contains no path separator.
  // Assert containment the same way as the traversal test: resolved path
  // starts with the resolved root, not a string match on the output.
  it('confines a name that sanitizes to ".."', () => {
    const root = path.resolve(spTmpDir());
    const result = path.resolve(spTmp('..'));
    expect(result.startsWith(root + path.sep)).toBe(true);
  });

  it('confines a name that sanitizes to "."', () => {
    const root = path.resolve(spTmpDir());
    const result = path.resolve(spTmp('.'));
    expect(result.startsWith(root + path.sep)).toBe(true);
  });

  it('confines an empty name strictly inside the root, not equal to it', () => {
    const root = path.resolve(spTmpDir());
    const result = path.resolve(spTmp(''));
    expect(result.startsWith(root + path.sep)).toBe(true);
    expect(result).not.toBe(root);
  });

  it('recovers when a non-directory file occupies the root', () => {
    // A stray regular file at <tmpdir>/sp permanently and silently breaks
    // every writer (mkdirSync throws ENOTDIR/EEXIST, and each caller's own
    // try/catch swallows the failed write). spTmpDir() must clear it and
    // retry rather than leaving it broken forever.
    //
    // Mocked, like the "cannot be created" test above, rather than actually
    // replacing the real <tmpdir>/sp: other test files write real state under
    // that same shared root concurrently, and recursively deleting it here
    // would race them.
    const dir = path.join(os.tmpdir(), ROOT_NAME);
    const realMkdir = fs.mkdirSync;
    const realLstat = fs.lstatSync;
    const realRm = fs.rmSync;
    let mkdirCalls = 0;
    let clearedNonDir = false;
    fs.mkdirSync = (p, opts) => {
      if (p !== dir) return realMkdir(p, opts);
      mkdirCalls++;
      if (mkdirCalls === 1) throw Object.assign(new Error('ENOTDIR'), { code: 'ENOTDIR' });
      return undefined; // retry succeeds
    };
    fs.lstatSync = (p) => {
      if (p !== dir) return realLstat(p);
      if (clearedNonDir) return { isDirectory: () => true, isSymbolicLink: () => false };
      return { isDirectory: () => false, isSymbolicLink: () => false };
    };
    fs.rmSync = (p, opts) => {
      if (p !== dir) return realRm(p, opts);
      clearedNonDir = true;
    };
    try {
      const result = spTmpDir();
      expect(result).toBe(dir);
      expect(mkdirCalls).toBe(2);
      expect(clearedNonDir).toBe(true);
    } finally {
      fs.mkdirSync = realMkdir;
      fs.lstatSync = realLstat;
      fs.rmSync = realRm;
    }
  });
});
