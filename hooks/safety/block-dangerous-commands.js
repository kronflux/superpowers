#!/usr/bin/env node
/**
 * Block Dangerous Commands — PreToolUse Hook for Bash
 *
 * Blocks dangerous shell command patterns before execution.
 * Three configurable safety levels: critical, high, strict.
 *
 * Based on claude-code-hooks by karanb192 (MIT License).
 *
 * Logs blocked commands to: ~/.claude/hooks-logs/YYYY-MM-DD.jsonl
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { configDir } from '../lib/config-dir.js';
import { splitSegments } from '../lib/command-segments.js';

const SAFETY_LEVEL = 'high';

const PATTERNS = [
  // CRITICAL — Catastrophic, unrecoverable
  { level: 'critical', id: 'rm-home',          regex: /\brm\s+(-\S+\s+)*["']?~\/?["']?(\s|$|[;&|])/,                        reason: 'rm targeting home directory' },
  { level: 'critical', id: 'rm-home-var',      regex: /\brm\s+(-\S+\s+)*["']?\$HOME["']?(\s|$|[;&|])/,                      reason: 'rm targeting $HOME' },
  { level: 'critical', id: 'rm-home-trailing', regex: /\brm\s+.+\s+["']?(~\/?|\$HOME)["']?(\s*$|[;&|])/,                   reason: 'rm with trailing ~/ or $HOME' },
  { level: 'critical', id: 'rm-root',          regex: /\brm\s+(-\S+\s+)*\/(\*|\s|$|[;&|])/,                                 reason: 'rm targeting root filesystem' },
  { level: 'critical', id: 'rm-system',        regex: /\brm\s+(-\S+\s+)*\/(etc|usr|var|bin|sbin|lib|boot|dev|proc|sys)(\/|\s|$)/, reason: 'rm targeting system directory' },
  { level: 'critical', id: 'rm-cwd',           regex: /\brm\s+(-\S+\s+)*(\.\/?|\*|\.\/\*)(\s|$|[;&|])/,                     reason: 'rm deleting current directory contents' },
  { level: 'critical', id: 'dd-disk',          regex: /\bdd\b.+of=\/dev\/(sd[a-z]|nvme|hd[a-z]|vd[a-z]|xvd[a-z])/,         reason: 'dd writing to disk device' },
  { level: 'critical', id: 'mkfs',             regex: /\bmkfs(\.\w+)?\s+\/dev\/(sd[a-z]|nvme|hd[a-z]|vd[a-z])/,            reason: 'mkfs formatting disk' },
  { level: 'critical', id: 'fork-bomb',        regex: /:\(\)\s*\{.*:\s*\|\s*:.*&/,                                         reason: 'fork bomb detected' },

  // HIGH — Significant risk, data loss, security
  { level: 'high', id: 'curl-pipe-sh',   regex: /\b(curl|wget)\b.+\|\s*(ba)?sh\b/,                                        reason: 'piping URL to shell (RCE risk)' },
  { level: 'high', id: 'git-force-main', regex: /\bgit\s+push\b(?!.+--force-with-lease).+(--force|-f)\b.+\b(main|master)\b/, reason: 'force push to main/master' },
  { level: 'high', id: 'git-reset-hard', regex: /\bgit\s+reset\s+--hard/,                                                 reason: 'git reset --hard loses uncommitted work' },
  { level: 'high', id: 'git-clean-f',    regex: /\bgit\s+clean\s+(-\w*f|-f)/,                                             reason: 'git clean -f deletes untracked files' },
  { level: 'high', id: 'chmod-777',      regex: /\bchmod\b.+\b777\b/,                                                     reason: 'chmod 777 is a security risk' },
  { level: 'high', id: 'cat-env',        regex: /\b(cat|less|head|tail|more)\s+\.env\b/,                                  reason: 'reading .env file exposes secrets' },
  { level: 'high', id: 'cat-secrets',    regex: /\b(cat|less|head|tail|more)\b.+(credentials|secrets?|\.pem|\.key|id_rsa|id_ed25519)/i, reason: 'reading secrets file' },
  { level: 'high', id: 'echo-secret',    regex: /\becho\b.+\$\w*(SECRET|KEY|TOKEN|PASSWORD|API_|PRIVATE)/i,               reason: 'echoing secret variable' },
  { level: 'high', id: 'docker-vol-rm',  regex: /\bdocker\s+volume\s+(rm|prune)/,                                         reason: 'docker volume deletion loses data' },
  { level: 'high', id: 'rm-ssh',         regex: /\brm\b.+\.ssh\/(id_|authorized_keys|known_hosts)/,                       reason: 'deleting SSH keys' },

  // STRICT — Cautionary, context-dependent
  { level: 'strict', id: 'git-force-any',    regex: /\bgit\s+push\b(?!.+--force-with-lease).+(--force|-f)\b/,              reason: 'force push (use --force-with-lease)' },
  { level: 'strict', id: 'git-checkout-dot', regex: /\bgit\s+checkout\s+\./,                                               reason: 'git checkout . discards changes' },
  { level: 'strict', id: 'sudo-rm',          regex: /\bsudo\s+rm\b/,                                                       reason: 'sudo rm has elevated privileges' },
  { level: 'strict', id: 'docker-prune',     regex: /\bdocker\s+(system|image)\s+prune/,                                   reason: 'docker prune removes images' },
  { level: 'strict', id: 'crontab-r',        regex: /\bcrontab\s+-r/,                                                      reason: 'removes all cron jobs' },
];

// ASK tier — legitimate-but-sweeping git forms. Never denied: these raise the
// native permission prompt so deliberate bulk staging survives one click.
// Each pattern matches `git` at any command position within one shell
// segment — a leading `sudo`, `env FOO=1`, `time`, or a `;`-split `then`/`do`
// keyword sits before it and is not part of the match. The segment boundary,
// not a `^` anchor, is what stops a token sequence from crossing into the
// next command.
const ASK_PATTERNS = [
  { id: 'git-add-dot', regex: /\bgit\s+add\s+(?:-\S+\s+)*["']?\.\/?["']?\s*$/, reason: 'git add . stages everything under the cwd - stage explicit paths (skills/shared/git-hygiene.md), or allow if bulk staging is intended' },
  { id: 'git-commit-all', regex: /\bgit\s+commit\s+(?:[^\s]+\s+)*(?:-(?!-)[a-zA-Z]*a[a-zA-Z]*\b|--all\b)/, reason: 'git commit -a stages every modified file - commit explicit paths (skills/shared/git-hygiene.md), or allow if intended' },
];

// Pathspecs that do not scope the operation: `git add -A .` sweeps the whole
// repository exactly as a bare `git add -A` does.
const NON_SCOPING = new Set(['.', './', '*', './*', '$(pwd)']);

/**
 * True when a `git add` segment stages the whole repository: it carries `-A`
 * or `--all` and either names no pathspec, or names only pathspecs that
 * resolve to the repository root.
 */
function isBulkAdd(segment, repoRoot) {
  const m = /\bgit\s+add\s+(.*)$/.exec(segment);
  if (!m) return false;
  const root = path.resolve(repoRoot || process.cwd());
  let sawAll = false;
  const pathspecs = [];
  for (const token of m[1].split(/\s+/).filter(Boolean)) {
    if (/^\d?[<>]/.test(token)) break; // a redirect ends the pathspec list
    if (token === '--all' || /^-(?!-)[a-zA-Z]*A[a-zA-Z]*$/.test(token)) { sawAll = true; continue; }
    if (token.startsWith('-')) continue;
    pathspecs.push(token);
  }
  if (!sawAll) return false;
  if (pathspecs.length === 0) return true;
  return pathspecs.some((p) => NON_SCOPING.has(p) || path.resolve(root, p) === root);
}

const BULK_ADD_REASON = 'bulk staging sweeps unrelated local changes into the commit - stage explicit paths (skills/shared/git-hygiene.md), or allow if bulk staging is intended';

function checkAsk(cmd, opts = {}) {
  const repoRoot = opts.repoRoot;
  for (const segment of splitSegments(cmd)) {
    if (isBulkAdd(segment, repoRoot)) {
      return { ask: true, pattern: { id: 'git-add-all', reason: BULK_ADD_REASON } };
    }
    for (const p of ASK_PATTERNS) {
      if (p.regex.test(segment)) return { ask: true, pattern: p };
    }
  }
  return { ask: false, pattern: null };
}

const LEVELS = { critical: 1, high: 2, strict: 3 };
const EMOJIS = { critical: '🚨', high: '⛔', strict: '⚠️' };

const LOG_DIR = path.join(configDir(process.env), 'hooks-logs');

function log(data) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), hook: 'block-dangerous-commands', ...data }) + '\n');
  } catch {}
}

function checkCommand(cmd, safetyLevel = SAFETY_LEVEL) {
  const threshold = LEVELS[safetyLevel] || 2;
  for (const p of PATTERNS) {
    if (LEVELS[p.level] <= threshold && p.regex.test(cmd)) {
      return { blocked: true, pattern: p };
    }
  }
  return { blocked: false, pattern: null };
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  try {
    const data = JSON.parse(input);
    const { tool_name, tool_input, session_id, cwd, permission_mode } = data;

    if (tool_name !== 'Bash') {
      process.stdout.write('{}');
      return;
    }

    const cmd = tool_input?.command || '';
    const result = checkCommand(cmd);

    if (result.blocked) {
      const p = result.pattern;
      log({ level: 'BLOCKED', id: p.id, priority: p.level, cmd, session_id, cwd, permission_mode });
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `${EMOJIS[p.level]} [${p.id}] ${p.reason}`,
        },
      }));
      return;
    }

    const askResult = checkAsk(cmd, { repoRoot: cwd });
    if (askResult.ask) {
      const p = askResult.pattern;
      log({ level: 'ASK', id: p.id, cmd, session_id, cwd, permission_mode });
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: `[${p.id}] ${p.reason}`,
        },
      }));
      return;
    }

    process.stdout.write('{}');
  } catch (e) {
    log({ level: 'ERROR', error: e.message });
    process.stdout.write('{}');
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main();
}

export { PATTERNS, ASK_PATTERNS, LEVELS, SAFETY_LEVEL, checkCommand, checkAsk, isBulkAdd };
