// hooks/lib/statusline-segments.js — one function per statusline segment.
//
// Every segment returns a short string or null. Null means "render nothing":
// a bar that reports "unknown" four times is worse than a short bar, and there
// are only ~80 columns. No segment may throw — the renderer is on the path of
// every assistant message and a visible failure lands in the user's terminal.
import fs from 'fs';
import path from 'path';
import { tailLines } from './tail-read.js';
import { spTmp } from './sp-tmp.js';
import { probe } from './capability-registry.js';

const CAP_CODES = {
  codegraph: 'cg', context7: 'c7', docfork: 'df', middleware: 'mw', lsp: 'lsp',
};

/** Compact a token count: 1_500_000 -> "1.5M", 2500 -> "2.5k". */
function human(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

// --- capabilities ---------------------------------------------------------
// probe() reads installed_plugins.json plus a marketplace manifest per plugin.
// That is far too much for a path that runs on every assistant message, so the
// result is cached per session. Safe because capabilities are already frozen
// per session by design.
function segCapabilities(ctx) {
  const sid = String(ctx.stdin?.session_id || 'default');
  const cache = spTmp(`statusline-caps-${sid}.json`);
  let present;
  try {
    present = JSON.parse(fs.readFileSync(cache, 'utf8')).present;
  } catch {
    try {
      // env is threaded through so tests can sandbox the probe. Without it the
      // probe reads the real config root and finds the developer's own plugins,
      // which makes any "nothing installed" assertion machine-dependent. home
      // is derived from env the same way config-dir.js does (HOME||USERPROFILE)
      // and passed explicitly: probe()'s home resolution falls back to the
      // real os.homedir() unless opts.home overrides it, and that real home's
      // ~/.claude.json is exactly the kind of global config env alone can't hide.
      const opts = ctx.env ? { env: ctx.env, home: ctx.env.HOME || ctx.env.USERPROFILE } : undefined;
      const caps = probe(ctx.probeCwd || ctx.cwd, opts);
      present = Object.entries(caps)
        .filter(([, v]) => v && v.status && v.status !== 'absent')
        .map(([k]) => k);
    } catch {
      present = [];
    }
    try { fs.writeFileSync(cache, JSON.stringify({ present })); } catch {}
  }
  if (!Array.isArray(present)) return null;
  const codes = present.map((k) => CAP_CODES[k]).filter(Boolean);
  return codes.length ? codes.join('·') : null;
}

// --- delegation -----------------------------------------------------------
// Only routing-dispatch.log is session-attributable. middleware-usage.jsonl
// carries no session id (middleware-exec is a standalone CLI with no session in
// scope), so including it would mis-attribute whenever two windows are open —
// precisely when a wrong answer is most damaging. Middleware cost lives in
// /superpowers:usage instead.
function segDelegation(ctx) {
  const sid = ctx.stdin?.session_id;
  if (!sid) return null;
  const lines = tailLines(path.join(ctx.logDir, 'routing-dispatch.log'));
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /\bsession=(\S+)\b/.exec(lines[i]);
    if (!m || m[1] !== sid) continue; // legacy unstamped records are skipped, not claimed
    const model = /\bmodel=(\S+)/.exec(lines[i]);
    const blocked = /\bBLOCK\b/.test(lines[i]);
    if (!model) return null;
    return `${blocked ? '⊘' : '→'}${model[1]}`;
  }
  return null;
}

// --- plan progress --------------------------------------------------------
// Reads the plan's own .tasks.json snapshot. It can lag if tasks are closed
// outside the plan flow — accepted, since the alternative is coupling the
// statusline to native task state.
function segPlan(ctx) {
  try {
    const dir = path.join(ctx.cwd, '.superpowers', 'plans');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md.tasks.json')).sort();
    if (!files.length) return null;
    const newest = files[files.length - 1];
    const data = JSON.parse(fs.readFileSync(path.join(dir, newest), 'utf8'));
    const tasks = Array.isArray(data.tasks) ? data.tasks : null;
    if (!tasks || !tasks.length) return null;
    const done = tasks.filter((t) => t && t.status === 'completed').length;
    return `plan ${done}/${tasks.length}`;
  } catch {
    return null;
  }
}

// --- session usage --------------------------------------------------------
function segUsage(ctx) {
  const sid = ctx.stdin?.session_id;
  if (!sid) return null;
  // claude-usage.jsonl is append-only, unrotated, and interleaves every
  // session's per-Stop deltas. A window too small drops this session's OWN
  // early records once enough later ones accumulate, and the displayed total
  // then DECREASES mid-session. At ~153 B/record, 256 KB holds ~1,700 records
  // — far beyond any plausible session, where 16 KB held only ~106. Still one
  // bounded read. The residual limit is real but unreachable in practice.
  const lines = tailLines(path.join(ctx.logDir, 'claude-usage.jsonl'), 262144);
  let cacheRead = 0; let output = 0; let seen = false;
  for (const l of lines) {
    let r;
    try { r = JSON.parse(l); } catch { continue; }
    if (!r || r.sessionId !== sid) continue;
    seen = true;
    cacheRead += Number(r.cacheRead) || 0;
    output += Number(r.output) || 0;
  }
  return seen ? `${human(cacheRead)}↓ ${human(output)}↑` : null;
}

export { segCapabilities, segDelegation, segPlan, segUsage, human, CAP_CODES };
