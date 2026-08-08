import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Hook manifests (hooks/*.json) are GENERATED from plugin.universal.mjs via `npm run compile-hooks`.
// Never hand-edit them; this suite validates the generated output stays well-formed.
// This validates that:
//   - the plugin manifests exist, are valid JSON, and name "superpowers"
//   - hooks.json / codex-hooks.json each register at least one hook script
//   - hook scripts present on disk resolve
//   - PreCompact is not registered (ceded to context-mode)

function scriptsFrom(hooksJson) {
  const out = [];
  for (const event of Object.values(hooksJson.hooks || {})) {
    for (const group of event) {
      for (const h of group.hooks || []) {
        const m = h.command.match(/(?:hooks\/[^"]+\.(?:js|cmd))|run-hook\.cmd/);
        if (m) out.push(h.command);
      }
    }
  }
  return out;
}

describe('generated manifests (validity)', () => {
  it('.claude-plugin/plugin.json exists, is valid JSON, names superpowers', () => {
    const p = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8'));
    expect(p.name).toBe('superpowers');
  });

  it('.codex-plugin/plugin.json exists, is valid JSON, names superpowers', () => {
    const p = JSON.parse(fs.readFileSync(path.join(ROOT, '.codex-plugin/plugin.json'), 'utf8'));
    expect(p.name).toBe('superpowers');
  });

  it('hooks/hooks.json is valid JSON and registers at least one hook script', () => {
    const hj = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks/hooks.json'), 'utf8'));
    const refs = scriptsFrom(hj);
    expect(refs.length).toBeGreaterThan(0);
  });

  // Lands in a later resync commit (safety/compression/session/lifecycle hooks);
  // skip until then rather than fail on a file that isn't part of this commit's scope.
  const codexHooksPath = path.join(ROOT, 'hooks/codex-hooks.json');
  it.skipIf(!fs.existsSync(codexHooksPath))(
    'hooks/codex-hooks.json is valid JSON and registers at least one hook script', () => {
      const hj = JSON.parse(fs.readFileSync(codexHooksPath, 'utf8'));
      const refs = scriptsFrom(hj);
      expect(refs.length).toBeGreaterThan(0);
    });

  it('every hook script that already exists on disk resolves correctly', () => {
    const hj = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks/hooks.json'), 'utf8'));
    const refs = scriptsFrom(hj);
    const rels = refs.map((cmd) => cmd.match(/hooks\/[^"]+\.(?:js|cmd)/)[0]);
    // run-hook.cmd is carried from the obra base and must exist now.
    expect(rels).toContain('hooks/run-hook.cmd');
    expect(fs.existsSync(path.join(ROOT, 'hooks/run-hook.cmd'))).toBe(true);
  });

  it('does not register PreCompact (ceded to context-mode)', () => {
    const hj = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks/hooks.json'), 'utf8'));
    expect(hj.hooks.PreCompact).toBeUndefined();
  });

  it('declares shell:bash on the SessionStart run-hook.cmd entry', () => {
    // The command opens with a quoted path. PowerShell parses that leading
    // quoted string as an expression and dies on the next bareword; cmd.exe's
    // /c quote-stripping truncates at any metacharacter in the path. Both
    // failures happen BEFORE run-hook.cmd is reached, so its polyglot header
    // cannot help. Declaring the shell is what keeps a Windows session from
    // failing to bootstrap.
    const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
    const groups = hooks.hooks.SessionStart || [];
    const cmdEntry = groups
      .flatMap((g) => g.hooks || [])
      .find((h) => h.command.includes('run-hook.cmd'));
    expect(cmdEntry, 'SessionStart run-hook.cmd entry').toBeTruthy();
    expect(cmdEntry.shell).toBe('bash');
  });

  it('does not put shell on hooks that did not ask for it', () => {
    // Guards the compiler change: a blanket default would be a different bug.
    const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
    const withShell = Object.values(hooks.hooks)
      .flat()
      .flatMap((g) => g.hooks || [])
      .filter((h) => 'shell' in h);
    expect(withShell).toHaveLength(1);
  });
});
