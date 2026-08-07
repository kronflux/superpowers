// Compiles plugin.universal.mjs into the three committed hook manifests.
// Zero dependencies. Run via `npm run compile-hooks`.
// Validates every entry first, builds all outputs, then writes (all-or-nothing).

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import manifest from '../plugin.universal.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const TARGETS = {
  'claude-code': 'hooks/hooks.json',
  codex: 'hooks/codex-hooks.json',
  cursor: 'hooks/hooks-cursor.json',
};

export const VALID_EVENTS = new Set([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStop',
  'PreCompact',
  'SessionEnd',
]);

export function validate(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('manifest.hooks must be a non-empty array');
  }
  entries.forEach((entry, i) => {
    const at = `hooks[${i}]`;
    if (!VALID_EVENTS.has(entry.event)) {
      throw new Error(`${at}: invalid event "${entry.event}"`);
    }
    if (typeof entry.command !== 'string' || entry.command.length === 0) {
      throw new Error(`${at}: command must be a non-empty string`);
    }
    if (!Array.isArray(entry.platforms) || entry.platforms.length === 0) {
      throw new Error(`${at}: platforms must be a non-empty array`);
    }
    for (const p of entry.platforms) {
      if (!(p in TARGETS)) throw new Error(`${at}: unknown platform "${p}"`);
    }
    if ('matcher' in entry && (typeof entry.matcher !== 'string' || entry.matcher.length === 0)) {
      throw new Error(`${at}: matcher must be a non-empty string when present`);
    }
    if ('async' in entry && typeof entry.async !== 'boolean') {
      throw new Error(`${at}: async must be a boolean when present`);
    }
  });
}

function forPlatform(entries, platform) {
  return entries.filter((e) => e.platforms.includes(platform));
}

// claude-code and codex share one schema:
// { hooks: { Event: [ { matcher?, hooks: [ { type, command, async? } ] } ] } }
function emitClaudeStyle(entries) {
  const events = {};
  for (const e of entries) {
    const group = {};
    if ('matcher' in e) group.matcher = e.matcher;
    const hook = { type: 'command', command: e.command };
    if ('async' in e) hook.async = e.async;
    group.hooks = [hook];
    (events[e.event] ??= []).push(group);
  }
  return { hooks: events };
}

// cursor schema: { version: 1, hooks: { sessionStart: [ { command } ] } }
function emitCursor(entries) {
  const events = {};
  for (const e of entries) {
    const key = e.event[0].toLowerCase() + e.event.slice(1);
    (events[key] ??= []).push({ command: e.command });
  }
  return { version: 1, hooks: events };
}

export function build(m = manifest) {
  validate(m.hooks);
  return {
    'claude-code': JSON.stringify(emitClaudeStyle(forPlatform(m.hooks, 'claude-code')), null, 2) + '\n',
    codex: JSON.stringify(emitClaudeStyle(forPlatform(m.hooks, 'codex')), null, 2) + '\n',
    cursor: JSON.stringify(emitCursor(forPlatform(m.hooks, 'cursor')), null, 2) + '\n',
  };
}

function main() {
  const outputs = build();
  for (const [platform, relPath] of Object.entries(TARGETS)) {
    writeFileSync(join(ROOT, relPath), outputs[platform]);
    console.log(`wrote ${relPath}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
