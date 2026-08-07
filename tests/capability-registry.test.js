import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { probe, summaryLine, STATUS } from '../hooks/lib/capability-registry.js';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(spTmpDir(), 'capreg-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('capability-registry', () => {
  it('returns exactly the five live capabilities, all absent, in an empty dir', () => {
    const caps = probe(tmp, { home: tmp, env: { PATH: '', HOME: tmp } });
    expect(Object.keys(caps).sort()).toEqual(
      ['codegraph', 'context7', 'docfork', 'lsp', 'middleware'].sort());
    for (const v of Object.values(caps)) expect(v.status).toBe(STATUS.ABSENT);
  });

  it('no longer probes serena, obsidian-cli, or basic-memory', () => {
    const caps = probe(tmp, { home: tmp, env: { PATH: '', HOME: tmp } });
    expect(caps.serena).toBeUndefined();
    expect(caps['obsidian-cli']).toBeUndefined();
    expect(caps['basic-memory']).toBeUndefined();
  });

  it('detects context7 from home .claude.json project scope', () => {
    fs.writeFileSync(path.join(tmp, '.claude.json'),
      JSON.stringify({ projects: { [tmp]: { mcpServers: { 'context7-mcp': {} } } } }));
    expect(probe(tmp, { home: tmp, env: { PATH: '', HOME: tmp } }).context7.status).toBe(STATUS.CONFIGURED);
  });

  it('ignores unrelated projects in .claude.json', () => {
    const otherPath = path.join(tmp, 'other-project');
    fs.writeFileSync(path.join(tmp, '.claude.json'),
      JSON.stringify({ projects: { [otherPath]: { mcpServers: { 'context7-mcp': {} } } } }));
    expect(probe(tmp, { home: tmp, env: { PATH: '', HOME: tmp } }).context7.status).toBe(STATUS.ABSENT);
  });

  it('detects codegraph index dir and decline marker', () => {
    fs.mkdirSync(path.join(tmp, '.codegraph'));
    fs.writeFileSync(path.join(tmp, '.superpowers-no-codegraph'), '');
    const cg = probe(tmp, { home: tmp, env: { PATH: '', HOME: tmp } }).codegraph;
    expect(cg.indexed).toBe(true);
    expect(cg.declined).toBe(true);
  });

  it('detects middleware config in project .claude dir', () => {
    fs.mkdirSync(path.join(tmp, '.claude'));
    fs.writeFileSync(path.join(tmp, '.claude', 'middleware-config.json'), '{}');
    expect(probe(tmp, { home: tmp, env: { PATH: '', HOME: tmp } }).middleware.status).toBe(STATUS.CONFIGURED);
  });

  it('detects middleware config in the profile config root (CLAUDE_CONFIG_DIR)', () => {
    const prof = path.join(tmp, 'profile');
    fs.mkdirSync(prof, { recursive: true });
    fs.writeFileSync(path.join(prof, 'middleware-config.json'), '{}');
    // home has no config: only the profile root carries it. middleware-exec
    // resolves this path, so the probe must agree or onboarding writes a
    // config the registry can never see.
    const caps = probe(tmp, { home: tmp, env: { PATH: '', CLAUDE_CONFIG_DIR: prof } });
    expect(caps.middleware.status).toBe(STATUS.CONFIGURED);
  });

  it('survives corrupt config json', () => {
    fs.writeFileSync(path.join(tmp, '.mcp.json'), '{not json');
    expect(() => probe(tmp, { home: tmp, env: { PATH: '', HOME: tmp } })).not.toThrow();
  });

  it('summaryLine stays within 120 chars with everything present', () => {
    const caps = probe(tmp, { home: tmp, env: { PATH: '', HOME: tmp } });
    for (const v of Object.values(caps)) v.status = STATUS.CONFIGURED;
    expect(summaryLine(caps).length).toBeLessThanOrEqual(120);
  });

  it('probes decline markers for context7 and middleware', () => {
    fs.writeFileSync(path.join(tmp, '.superpowers-no-middleware'), '');
    const caps = probe(tmp, { home: tmp, env: { PATH: '', HOME: tmp } });
    expect(caps.middleware.declined).toBe(true);
    expect(caps.context7.declined).toBe(false);
  });

  it('detects a plugin-installed MCP server via installed_plugins.json', () => {
    const prof = path.join(tmp, 'prof');
    const inst = path.join(prof, 'plugins', 'cache', 'm', 'context7', '1.0.0');
    fs.mkdirSync(inst, { recursive: true });
    fs.writeFileSync(path.join(inst, '.mcp.json'), JSON.stringify({ mcpServers: { context7: {} } }));
    fs.mkdirSync(path.join(prof, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(prof, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ version: 1, plugins: { 'context7@m': [{ installPath: inst }] } }));
    const caps = probe(tmp, { home: tmp, env: { PATH: '', CLAUDE_CONFIG_DIR: prof } });
    expect(caps.context7.status).toBe(STATUS.CONFIGURED);
  });

  it('excludes a disabled plugin', () => {
    const prof = path.join(tmp, 'prof');
    const inst = path.join(prof, 'plugins', 'cache', 'm', 'context7', '1.0.0');
    fs.mkdirSync(inst, { recursive: true });
    fs.writeFileSync(path.join(inst, '.mcp.json'), JSON.stringify({ mcpServers: { context7: {} } }));
    fs.mkdirSync(path.join(prof, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(prof, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ version: 1, plugins: { 'context7@m': [{ installPath: inst }] } }));
    fs.writeFileSync(path.join(prof, 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'context7@m': false } }));
    const caps = probe(tmp, { home: tmp, env: { PATH: '', CLAUDE_CONFIG_DIR: prof } });
    expect(caps.context7.status).toBe(STATUS.ABSENT);
  });

  it('treats installed as enabled when settings.json or the field is absent', () => {
    const prof = path.join(tmp, 'prof');
    const inst = path.join(prof, 'plugins', 'cache', 'm', 'context7', '1.0.0');
    fs.mkdirSync(inst, { recursive: true });
    fs.writeFileSync(path.join(inst, '.mcp.json'), JSON.stringify({ mcpServers: { context7: {} } }));
    fs.mkdirSync(path.join(prof, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(prof, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ version: 1, plugins: { 'context7@m': [{ installPath: inst }] } }));
    const caps = probe(tmp, { home: tmp, env: { PATH: '', CLAUDE_CONFIG_DIR: prof } });
    expect(caps.context7.status).toBe(STATUS.CONFIGURED);
  });

  it('survives corrupt installed_plugins.json and settings.json', () => {
    const prof = path.join(tmp, 'prof'); fs.mkdirSync(path.join(prof, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(prof, 'plugins', 'installed_plugins.json'), '{bad');
    fs.writeFileSync(path.join(prof, 'settings.json'), '{bad');
    let caps;
    expect(() => { caps = probe(tmp, { home: tmp, env: { PATH: '', CLAUDE_CONFIG_DIR: prof } }); }).not.toThrow();
    expect(caps.context7.status).toBe(STATUS.ABSENT);
  });

  // --- lsp -------------------------------------------------------------

  // Mirrors how the OFFICIAL marketplace actually ships an LSP plugin, which is
  // NOT the layout the authoring docs describe: the install dir carries only
  // LICENSE/README, and `lspServers` lives in the marketplace manifest entry.
  // Verified against a real `/plugin install typescript-lsp@claude-plugins-official`
  // on 2026-08-06 — the original fixtures encoded the assumed layout instead, so
  // the probe passed every test while detecting nothing in the field.
  function installMarketplaceLspPlugin(prof, name, market, lspServers) {
    const inst = path.join(prof, 'plugins', 'cache', market, name, '1.0.0');
    fs.mkdirSync(inst, { recursive: true });
    fs.writeFileSync(path.join(inst, 'README.md'), '# stub\n');
    const mktDir = path.join(prof, 'plugins', 'marketplaces', market, '.claude-plugin');
    fs.mkdirSync(mktDir, { recursive: true });
    const mktPath = path.join(mktDir, 'marketplace.json');
    const mkt = fs.existsSync(mktPath)
      ? JSON.parse(fs.readFileSync(mktPath, 'utf8'))
      : { name: market, plugins: [] };
    mkt.plugins.push({ name, source: `./plugins/${name}`, lspServers });
    fs.writeFileSync(mktPath, JSON.stringify(mkt));
    fs.mkdirSync(path.join(prof, 'plugins'), { recursive: true });
    const idxPath = path.join(prof, 'plugins', 'installed_plugins.json');
    const idx = fs.existsSync(idxPath)
      ? JSON.parse(fs.readFileSync(idxPath, 'utf8'))
      : { version: 1, plugins: {} };
    idx.plugins[`${name}@${market}`] = [{ installPath: inst }];
    fs.writeFileSync(idxPath, JSON.stringify(idx));
  }

  it('reads covered extensions from a marketplace manifest entry', () => {
    const prof = path.join(tmp, 'prof');
    installMarketplaceLspPlugin(prof, 'typescript-lsp', 'claude-plugins-official', {
      typescript: {
        command: 'typescript-language-server',
        args: ['--stdio'],
        extensionToLanguage: { '.ts': 'typescript', '.TSX': 'typescriptreact', '.mts': 'typescript' },
      },
    });
    const caps = probe(tmp, { home: tmp, env: { PATH: '', CLAUDE_CONFIG_DIR: prof } });
    expect(caps.lsp.status).toBe(STATUS.CONFIGURED);
    expect(caps.lsp.extensions).toEqual(['.mts', '.ts', '.tsx']);
  });

  it('ignores a marketplace LSP entry whose plugin is not installed', () => {
    const prof = path.join(tmp, 'prof');
    installMarketplaceLspPlugin(prof, 'gopls-lsp', 'm', {
      go: { command: 'gopls', extensionToLanguage: { '.go': 'go' } },
    });
    // Uninstall it: the marketplace still advertises the plugin, but nothing
    // installed references it. Advertised != installed.
    fs.writeFileSync(path.join(prof, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ version: 1, plugins: {} }));
    const caps = probe(tmp, { home: tmp, env: { PATH: '', CLAUDE_CONFIG_DIR: prof } });
    expect(caps.lsp.status).toBe(STATUS.ABSENT);
    expect(caps.lsp.extensions).toEqual([]);
  });

  it('contributes no extensions from a disabled marketplace LSP plugin', () => {
    const prof = path.join(tmp, 'prof');
    installMarketplaceLspPlugin(prof, 'ruby-lsp', 'm', {
      ruby: { command: 'ruby-lsp', extensionToLanguage: { '.rb': 'ruby' } },
    });
    fs.writeFileSync(path.join(prof, 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'ruby-lsp@m': false } }));
    const caps = probe(tmp, { home: tmp, env: { PATH: '', CLAUDE_CONFIG_DIR: prof } });
    expect(caps.lsp.extensions).toEqual([]);
  });

  it('unions extensions across both plugin-local and marketplace layouts', () => {
    const prof = path.join(tmp, 'prof');
    installMarketplaceLspPlugin(prof, 'typescript-lsp', 'claude-plugins-official', {
      typescript: { command: 'x', extensionToLanguage: { '.ts': 'typescript' } },
    });
    installLspPlugin(prof, 'gopls-lsp', '.lsp.json', {
      go: { command: 'gopls', extensionToLanguage: { '.go': 'go' } },
    });
    const caps = probe(tmp, { home: tmp, env: { PATH: '', CLAUDE_CONFIG_DIR: prof } });
    expect(caps.lsp.extensions).toEqual(['.go', '.ts']);
  });

  it('survives a corrupt marketplace manifest', () => {
    const prof = path.join(tmp, 'prof');
    const mktDir = path.join(prof, 'plugins', 'marketplaces', 'm', '.claude-plugin');
    fs.mkdirSync(mktDir, { recursive: true });
    fs.writeFileSync(path.join(mktDir, 'marketplace.json'), '{not json');
    fs.mkdirSync(path.join(prof, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(prof, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ version: 1, plugins: { 'lua-lsp@m': [{ installPath: path.join(prof, 'nope') }] } }));
    let caps;
    expect(() => { caps = probe(tmp, { home: tmp, env: { PATH: '', CLAUDE_CONFIG_DIR: prof } }); }).not.toThrow();
    expect(caps.lsp.extensions).toEqual([]);
  });

  function installLspPlugin(prof, name, file, body) {
    const inst = path.join(prof, 'plugins', 'cache', 'm', name, '1.0.0');
    fs.mkdirSync(inst, { recursive: true });
    fs.writeFileSync(path.join(inst, file), typeof body === 'string' ? body : JSON.stringify(body));
    fs.mkdirSync(path.join(prof, 'plugins'), { recursive: true });
    const idxPath = path.join(prof, 'plugins', 'installed_plugins.json');
    const idx = fs.existsSync(idxPath)
      ? JSON.parse(fs.readFileSync(idxPath, 'utf8'))
      : { version: 1, plugins: {} };
    idx.plugins[`${name}@m`] = [{ installPath: inst }];
    fs.writeFileSync(idxPath, JSON.stringify(idx));
    return inst;
  }

  it('reads covered extensions from a plugin .lsp.json', () => {
    const prof = path.join(tmp, 'prof');
    installLspPlugin(prof, 'gopls-lsp', '.lsp.json', {
      go: { command: 'gopls', args: ['serve'], extensionToLanguage: { '.go': 'go' } },
    });
    const caps = probe(tmp, { home: tmp, env: { PATH: '', CLAUDE_CONFIG_DIR: prof } });
    expect(caps.lsp.status).toBe(STATUS.CONFIGURED);
    expect(caps.lsp.extensions).toEqual(['.go']);
  });

  it('reads covered extensions from inline plugin.json lspServers', () => {
    const prof = path.join(tmp, 'prof');
    installLspPlugin(prof, 'typescript-lsp', 'plugin.json', {
      name: 'typescript-lsp',
      lspServers: {
        ts: { command: 'typescript-language-server', extensionToLanguage: { '.ts': 'typescript', '.TSX': 'typescriptreact' } },
      },
    });
    const caps = probe(tmp, { home: tmp, env: { PATH: '', CLAUDE_CONFIG_DIR: prof } });
    expect(caps.lsp.extensions).toEqual(['.ts', '.tsx']);
  });

  it('contributes no extensions from a disabled LSP plugin', () => {
    const prof = path.join(tmp, 'prof');
    installLspPlugin(prof, 'gopls-lsp', '.lsp.json', {
      go: { command: 'gopls', extensionToLanguage: { '.go': 'go' } },
    });
    fs.writeFileSync(path.join(prof, 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'gopls-lsp@m': false } }));
    const caps = probe(tmp, { home: tmp, env: { PATH: '', CLAUDE_CONFIG_DIR: prof } });
    expect(caps.lsp.status).toBe(STATUS.ABSENT);
    expect(caps.lsp.extensions).toEqual([]);
  });

  it('degrades to no coverage on a malformed LSP manifest', () => {
    const prof = path.join(tmp, 'prof');
    installLspPlugin(prof, 'lua-lsp', '.lsp.json', '{not json');
    let caps;
    expect(() => { caps = probe(tmp, { home: tmp, env: { PATH: '', CLAUDE_CONFIG_DIR: prof } }); }).not.toThrow();
    expect(caps.lsp.extensions).toEqual([]);
  });

  it('parses .superpowers-no-lsp as a per-plugin decline list', () => {
    fs.writeFileSync(path.join(tmp, '.superpowers-no-lsp'), 'typescript-lsp\npyright-lsp\n');
    const caps = probe(tmp, { home: tmp, env: { PATH: '', HOME: tmp } });
    expect(caps.lsp.declined).toEqual(['typescript-lsp', 'pyright-lsp']);
    expect(caps.lsp.declinedAll).toBe(false);
  });

  it('treats an empty .superpowers-no-lsp as declining everything', () => {
    fs.writeFileSync(path.join(tmp, '.superpowers-no-lsp'), '');
    const caps = probe(tmp, { home: tmp, env: { PATH: '', HOME: tmp } });
    expect(caps.lsp.declined).toEqual([]);
    expect(caps.lsp.declinedAll).toBe(true);
  });

  it('summaryLine reports lsp as a state, not a use-first entry', () => {
    const caps = probe(tmp, { home: tmp, env: { PATH: '', HOME: tmp } });
    for (const v of Object.values(caps)) v.status = STATUS.CONFIGURED;
    const line = summaryLine(caps);
    expect(line).toMatch(/use first: /);
    expect(line).not.toMatch(/use first: [^|]*lsp/);
    expect(line).toMatch(/lsp diagnostics active/);
    expect(line.length).toBeLessThanOrEqual(120);
  });
});
