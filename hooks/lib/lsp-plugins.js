// hooks/lib/lsp-plugins.js — official Claude Code LSP plugins, keyed by file
// extension.
//
// Source: the anthropics/claude-plugins-official marketplace. LSP servers are
// configured by plugins only (Claude Code ignores lspServers in project
// settings), so a plugin name is the whole of what an install offer needs.
// tests/lsp-plugins.test.js asserts every value here is a real marketplace
// entry — an upstream rename fails there rather than producing an offer for a
// plugin that cannot be installed.

const EXTENSION_TO_PLUGIN = {
  '.ts': 'typescript-lsp',
  '.tsx': 'typescript-lsp',
  '.js': 'typescript-lsp',
  '.jsx': 'typescript-lsp',
  '.mjs': 'typescript-lsp',
  '.cjs': 'typescript-lsp',
  '.py': 'pyright-lsp',
  '.rs': 'rust-analyzer-lsp',
  '.go': 'gopls-lsp',
  '.rb': 'ruby-lsp',
  '.java': 'jdtls-lsp',
  '.kt': 'kotlin-lsp',
  '.kts': 'kotlin-lsp',
  '.cs': 'csharp-lsp',
  '.c': 'clangd-lsp',
  '.h': 'clangd-lsp',
  '.cpp': 'clangd-lsp',
  '.hpp': 'clangd-lsp',
  '.cc': 'clangd-lsp',
  '.php': 'php-lsp',
  '.lua': 'lua-lsp',
  '.swift': 'swift-lsp',
  '.liquid': 'liquid-lsp',
};

/** Lowercased extension (with dot) of a path, or null. */
function extensionOf(filePath) {
  if (typeof filePath !== 'string') return null;
  const m = /(\.[A-Za-z0-9]+)$/.exec(filePath);
  return m ? m[1].toLowerCase() : null;
}

/** Official LSP plugin covering this path's language, or null. */
function pluginForPath(filePath) {
  const ext = extensionOf(filePath);
  return ext ? (EXTENSION_TO_PLUGIN[ext] || null) : null;
}

export { EXTENSION_TO_PLUGIN, extensionOf, pluginForPath };
