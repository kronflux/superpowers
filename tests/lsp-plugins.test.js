import { describe, it, expect } from 'vitest';
import { EXTENSION_TO_PLUGIN, pluginForPath } from '../hooks/lib/lsp-plugins.js';

// The 13 LSP plugins published in anthropics/claude-plugins-official as of
// 2026-08-06. Recorded literally rather than fetched: this test must be
// hermetic and run offline. If upstream renames one, this list is the single
// place to update — and the mismatch fails here instead of making the
// conductor offer a plugin that does not exist.
const MARKETPLACE_LSP_PLUGINS = [
  'clangd-lsp', 'csharp-lsp', 'gopls-lsp', 'jdtls-lsp', 'kotlin-lsp',
  'liquid-lsp', 'lua-lsp', 'php-lsp', 'pyright-lsp', 'ruby-lsp',
  'rust-analyzer-lsp', 'swift-lsp', 'typescript-lsp',
];

describe('lsp-plugins', () => {
  it('maps only to real marketplace plugin names', () => {
    const unknown = [...new Set(Object.values(EXTENSION_TO_PLUGIN))]
      .filter((name) => !MARKETPLACE_LSP_PLUGINS.includes(name));
    expect(unknown).toEqual([]);
  });

  it('reaches all 13 marketplace plugins', () => {
    const mapped = new Set(Object.values(EXTENSION_TO_PLUGIN));
    const unreachable = MARKETPLACE_LSP_PLUGINS.filter((name) => !mapped.has(name));
    expect(unreachable).toEqual([]);
  });

  it('resolves a path to its plugin, case-insensitively', () => {
    expect(pluginForPath('src/index.ts')).toBe('typescript-lsp');
    expect(pluginForPath('C:\\repo\\Main.PY')).toBe('pyright-lsp');
    expect(pluginForPath('lib/thing.rs')).toBe('rust-analyzer-lsp');
    expect(pluginForPath('a/b/c.hpp')).toBe('clangd-lsp');
  });

  it('returns null for unmapped, extensionless, and non-string paths', () => {
    expect(pluginForPath('notes.md')).toBeNull();
    expect(pluginForPath('Makefile')).toBeNull();
    expect(pluginForPath(undefined)).toBeNull();
    expect(pluginForPath(42)).toBeNull();
  });
});
