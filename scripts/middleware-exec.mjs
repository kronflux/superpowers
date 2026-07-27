#!/usr/bin/env node
// middleware-exec — route mechanical LLM tasks to a configurable OpenAI-compatible endpoint.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configDir } from '../hooks/lib/config-dir.js';

const EXIT = { OK: 0, USAGE: 1, UNCONFIGURED: 2, ENDPOINT: 3 };

const TEMPLATES = {
  'extract-log-error':
    'Extract the root-cause error from this log. Output at most 5 lines: error message, file:line, first relevant stack frame, probable cause.\n\n{{input}}',
  'summarize-test-failure':
    'Summarize this test output in at most 5 lines: failing test names, expected vs actual, most likely broken source location.\n\n{{input}}',
  'scaffold-tests':
    'Write unit-test boilerplate for the following code. Output tests only, no prose.\n\n{{input}}',
};

export function resolveConfig(cwd = process.cwd(), home = os.homedir(), env = process.env) {
  const candidates = [
    path.join(cwd, '.claude', 'middleware-config.json'),
    path.join(configDir(env), 'middleware-config.json'),
    path.join(home, '.claude', 'middleware-config.json'),
  ].filter((p, i, a) => a.findIndex((q) => path.resolve(q) === path.resolve(p)) === i);
  for (const p of candidates) {
    try { return { cfg: JSON.parse(fs.readFileSync(p, 'utf8')), source: p }; } catch { /* next */ }
  }
  return null;
}

export function endpointFor(cfg, env = process.env) {
  const ep = cfg.endpoints?.[cfg.active_provider];
  if (!ep) throw Object.assign(new Error(`active_provider "${cfg.active_provider}" not defined in endpoints`), { exit: EXIT.UNCONFIGURED });
  const key = ep.api_key_env ? env[ep.api_key_env] : undefined;
  let local = false;
  try { const h = new URL(ep.base_url).hostname; local = h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]'; } catch { /* invalid URL treated as remote */ }
  if (!key && !local) throw Object.assign(new Error(`env var ${ep.api_key_env} not set for remote endpoint`), { exit: EXIT.UNCONFIGURED });
  return { baseUrl: ep.base_url.replace(/\/+$/, ''), model: cfg.active_model || ep.model, key };
}

export function renderTemplate(task, input, cfg = {}) {
  const tpl = cfg.templates?.[task] ?? TEMPLATES[task];
  if (!tpl) throw Object.assign(new Error(`unknown task "${task}". Known: ${[...Object.keys(TEMPLATES), ...Object.keys(cfg.templates || {})].join(', ')}`), { exit: EXIT.USAGE });
  const cap = (cfg.max_context_window || 128000) * 3;
  const body = input.length > cap ? `[truncated ${input.length - cap} chars]\n` + input.slice(-cap) : input;
  return tpl.replace('{{input}}', () => body);
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { const k = argv[i].slice(2); const v = argv[i + 1]; a[k] = v && !v.startsWith('--') ? (i++, v) : true; }
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const die = (msg, code) => { console.error(`middleware-exec: ${msg}`); process.exit(code); };
  if (!args.task || typeof args.task !== 'string') die('usage: middleware-exec --task <name> [--input-file F] [--out F]', EXIT.USAGE);
  const resolved = resolveConfig();
  if (!resolved) die('no middleware-config.json in ./.claude/ or ~/.claude/ — see docs/superpowers/middleware-config.example.json', EXIT.UNCONFIGURED);
  const input = args['input-file'] ? fs.readFileSync(args['input-file'], 'utf8') : fs.readFileSync(0, 'utf8');
  try {
    const { baseUrl, model, key } = endpointFor(resolved.cfg);
    const prompt = renderTemplate(args.task, input, resolved.cfg);
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) die(`endpoint ${res.status}: ${(await res.text()).slice(0, 300)}`, EXIT.ENDPOINT);
    const out = (await res.json()).choices?.[0]?.message?.content ?? '';
    if (args.out && typeof args.out === 'string') fs.writeFileSync(args.out, out); else process.stdout.write(out);
  } catch (e) { die(e.message, e.exit ?? EXIT.ENDPOINT); }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main();
