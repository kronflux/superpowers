#!/usr/bin/env node
// middleware-exec — route mechanical LLM tasks to a configurable OpenAI-compatible endpoint.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { configDir } from '../hooks/lib/config-dir.js';

const EXIT = { OK: 0, USAGE: 1, UNCONFIGURED: 2, ENDPOINT: 3 };

// CSI sequences cover the colouring these CLIs emit; exotic escapes are out of scope.
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
const stripAnsi = (s) => s.replace(ANSI_RE, '');

// Flags verified 2026-07-29 against each binary's --help; input_mode verified by
// invocation (see .superpowers/sdd/task-4-cli-evidence.md). `argvArgs` carries the
// prompt inline; `stdinArgs` is the same invocation without the placeholder, so an
// explicit input_mode override cannot produce a command that fails its own validation.
// codex/gemini are deliberately absent: not installed, so not verifiable.
export const PRESETS = {
  // stdin NOT usable: `agy -p` with no value fails flag parsing before any model call.
  agy:      { base: ['agy'],      modelFlag: '--model', argvArgs: ['-p', '{{prompt}}'],  stdinArgs: ['-p'],  input_mode: 'argv' },
  // stdin verified working: prompt piped, no positional argument, exit 0.
  // -m/--model is an option of the `run` subcommand, not global, so `run` moves
  // into base to keep the flag positioned after it.
  opencode: { base: ['opencode', 'run'], modelFlag: '-m', argvArgs: ['{{prompt}}'], stdinArgs: [], input_mode: 'stdin' },
  claude:   { base: ['claude'],   modelFlag: '--model', argvArgs: ['-p', '{{prompt}}'],  stdinArgs: ['-p'],  input_mode: 'stdin' },
};

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

export function cliDescriptor(ep, model, env = process.env) {
  const bad = (msg) => Object.assign(new Error(msg), { exit: EXIT.UNCONFIGURED });
  if (ep.preset && ep.command) throw bad('cli endpoint sets both "preset" and "command"; they are mutually exclusive');

  let command;
  let presetMode;
  if (ep.preset) {
    const pre = PRESETS[ep.preset];
    if (!pre) throw bad(`unknown preset "${ep.preset}". Known: ${Object.keys(PRESETS).join(', ')}`);
    presetMode = pre.input_mode;
    // The EFFECTIVE mode decides which arg form to expand, so an explicit
    // override never yields a command that fails the placeholder validation.
    const mode = ep.input_mode || presetMode;
    const tail = mode === 'stdin' ? pre.stdinArgs : pre.argvArgs;
    command = [...pre.base, ...(model ? [pre.modelFlag, model] : []), ...tail];
  } else if (Array.isArray(ep.command) && ep.command.length > 0) {
    command = ep.command;
  } else {
    throw bad('cli endpoint needs either "preset" or a non-empty "command" array');
  }

  const inputMode = ep.input_mode || presetMode || 'argv';
  if (inputMode !== 'argv' && inputMode !== 'stdin') throw bad(`input_mode must be "argv" or "stdin", got "${inputMode}"`);

  if (command.some((a) => typeof a !== 'string')) {
    throw bad('every "command" element must be a string — a non-string first element throws, and a later one is silently dropped from the child\'s arguments');
  }

  const hasPlaceholder = command.some((a) => typeof a === 'string' && a.includes('{{prompt}}'));
  if (inputMode === 'stdin' && hasPlaceholder) throw bad('input_mode "stdin" but command contains a {{prompt}} placeholder — the prompt would be delivered twice');
  if (inputMode === 'argv' && !hasPlaceholder) throw bad('input_mode "argv" but command has no {{prompt}} placeholder — the prompt would never reach the command');

  const num = (v, dflt, name) => {
    if (v === undefined || v === null) return dflt;
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      throw bad(`"${name}" must be a positive number, got ${JSON.stringify(v)}`);
    }
    return v;
  };

  if (ep.cwd !== undefined && ep.cwd !== null && (typeof ep.cwd !== 'string' || ep.cwd === '')) {
    throw bad('"cwd" must be a non-empty string when set');
  }

  return {
    transport: 'cli',
    command,
    inputMode,
    model,
    timeoutMs: num(ep.timeout_ms, 120000, 'timeout_ms'),
    maxArgvBytes: num(ep.max_argv_bytes, 30000, 'max_argv_bytes'),
    cwd: ep.cwd ?? null,
    env: { ...env, ...(ep.env || {}) },
  };
}

export function endpointFor(cfg, env = process.env) {
  const ep = cfg.endpoints?.[cfg.active_provider];
  if (!ep) throw Object.assign(new Error(`active_provider "${cfg.active_provider}" not defined in endpoints`), { exit: EXIT.UNCONFIGURED });
  const transport = ep.transport || 'http';
  const model = cfg.active_model || ep.model;
  if (transport === 'cli') return cliDescriptor(ep, model, env);
  if (transport !== 'http') {
    throw Object.assign(new Error(`unknown transport "${transport}" (expected "http" or "cli")`), { exit: EXIT.UNCONFIGURED });
  }
  // HTTP-only validation: a CLI endpoint has neither base_url nor api_key_env,
  // so this check must never run for one.
  const key = ep.api_key_env ? env[ep.api_key_env] : undefined;
  let local = false;
  try { const h = new URL(ep.base_url).hostname; local = h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]'; } catch { /* invalid URL treated as remote */ }
  if (!key && !local) throw Object.assign(new Error(`env var ${ep.api_key_env} not set for remote endpoint`), { exit: EXIT.UNCONFIGURED });
  return { transport: 'http', baseUrl: ep.base_url.replace(/\/+$/, ''), model, key };
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

export async function runHttp(desc, prompt) {
  const res = await fetch(`${desc.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(desc.key ? { authorization: `Bearer ${desc.key}` } : {}) },
    body: JSON.stringify({ model: desc.model, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw Object.assign(new Error(`endpoint ${res.status}: ${(await res.text()).slice(0, 300)}`), { exit: EXIT.ENDPOINT });
  return (await res.json()).choices?.[0]?.message?.content ?? '';
}

export function runCli(desc, prompt) {
  return new Promise((resolve, reject) => {
    const [cmd, ...rest] = desc.command;
    let args = rest;
    if (desc.inputMode === 'argv') {
      const bytes = Buffer.byteLength(prompt, 'utf8');
      if (bytes > desc.maxArgvBytes) {
        return reject(Object.assign(new Error(
          `rendered prompt is ${bytes} bytes, over the ${desc.maxArgvBytes}-byte argv limit for this endpoint. `
          + 'Set "input_mode": "stdin" on this endpoint, or raise "max_argv_bytes".'), { exit: EXIT.ENDPOINT }));
      }
      // Function replacer: a string replacement would let JavaScript interpret
      // $&, $`, $', $1 inside the PROMPT and corrupt the command.
      args = rest.map((a) => (typeof a === 'string' ? a.replace('{{prompt}}', () => prompt) : a));
    }
    const ownedTemp = desc.cwd ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'sp-mw-'));
    const cwd = desc.cwd || ownedTemp;
    let timer;
    let done = false;
    const cleanupTemp = () => {
      if (!ownedTemp) return;
      try { fs.rmSync(ownedTemp, { recursive: true, force: true }); } catch { /* retried on close */ }
    };
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(v);
    };

    const child = spawn(cmd, args, { shell: false, cwd, env: desc.env, stdio: ['pipe', 'pipe', 'pipe'] });
    timer = setTimeout(() => {
      child.kill();
      finish(reject, Object.assign(new Error(`cli endpoint timed out after ${desc.timeoutMs}ms`), { exit: EXIT.ENDPOINT }));
    }, desc.timeoutMs);
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      finish(reject, Object.assign(
        new Error(e.code === 'ENOENT'
          ? `cli command "${cmd}" not found, or its "cwd" does not exist. On Windows a .cmd/.bat shim cannot be spawned without a shell — put its absolute path in "command".`
          : e.message),
        { exit: e.code === 'ENOENT' ? EXIT.UNCONFIGURED : EXIT.ENDPOINT }));
      cleanupTemp();
    });
    child.on('close', (code) => {
      if (code === 0) finish(resolve, stripAnsi(out).trim());
      else finish(reject, Object.assign(new Error(`cli exited ${code}: ${err.trim().slice(-300)}`), { exit: EXIT.ENDPOINT }));
      cleanupTemp();
    });

    if (desc.inputMode === 'stdin') {
      child.stdin.on('error', () => { /* EPIPE: child already closed stdin */ });
      child.stdin.end(prompt);
    } else {
      child.stdin.on('error', () => { /* EPIPE: child already closed stdin */ });
      child.stdin.end();
    }
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const die = (msg, code) => { console.error(`middleware-exec: ${msg}`); process.exit(code); };
  if (!args.task || typeof args.task !== 'string') die('usage: middleware-exec --task <name> [--input-file F] [--out F]', EXIT.USAGE);
  const resolved = resolveConfig();
  if (!resolved) die('no middleware-config.json in ./.claude/, $CLAUDE_CONFIG_DIR/, or ~/.claude/ — see docs/superpowers/middleware-config.example.json', EXIT.UNCONFIGURED);
  const input = args['input-file'] ? fs.readFileSync(args['input-file'], 'utf8') : fs.readFileSync(0, 'utf8');
  try {
    const desc = endpointFor(resolved.cfg);
    const prompt = renderTemplate(args.task, input, resolved.cfg);
    const out = desc.transport === 'cli' ? await runCli(desc, prompt) : await runHttp(desc, prompt);
    if (args.out && typeof args.out === 'string') fs.writeFileSync(args.out, out); else process.stdout.write(out);
  } catch (e) { die(e.message, e.exit ?? EXIT.ENDPOINT); }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main();
