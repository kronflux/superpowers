import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';

// Root cause (proven, not re-investigated here): on Windows, `python3` on
// PATH is frequently the Microsoft Store App Execution Alias stub. It
// exists, so `command -v python3` succeeds — but running it prints
// "Python was not found..." and exits non-zero (49 on this machine).
// hooks/examples/post-task-complete-revalidate.sh did
//   RESULT=$(python3 -c "$PY_PARSE" ... 2>/dev/null || echo "{}")
// so the stub's failure silently became "{}", every jq default kicked in,
// and the hook could not tell "no signal" from "checked, nothing found" —
// so it blocked every close (fail-CLOSED, contradicting its own
// "Fail-open" contract at line 49).
//
// This spec drives hooks/examples/lib-python.sh directly (resolution unit
// tests) and the real hook script end-to-end (fail-open + id-resolution
// integration tests) with synthetic fixtures. No mocking of bash/python —
// real subprocesses, real PATH manipulation.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'hooks', 'examples', 'lib-python.sh');
const POST_HOOK = path.join(ROOT, 'hooks', 'examples', 'post-task-complete-revalidate.sh');

function have(cmd, args = ['--version']) {
  return spawnSync(cmd, args, { encoding: 'utf8' }).status === 0;
}
const HAVE_BASH = have('bash');
const HAVE_JQ = have('jq');

// Isolate a minimal PATH that still resolves bash/jq/node from the real
// environment, without leaking every other PATH entry (in particular, we
// need control over exactly which `python*` binaries are visible).
function dirOf(bin) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir && exts.some((ext) => fs.existsSync(path.join(dir, bin + ext)))) return dir;
  }
  return null;
}
const BASE_SANDBOX = [dirOf('bash'), dirOf('jq'), dirOf('node')]
  .filter(Boolean)
  .filter((d, i, arr) => arr.indexOf(d) === i);

// Does any candidate under sp_resolve_python's own probe actually work on
// this machine? Used only to skip the id-resolution integration test (#4)
// gracefully in an environment with no python at all, rather than asserting
// on a false negative.
function haveWorkingPython() {
  for (const c of ['python3', 'python']) {
    if (have(c, ['-c', 'pass'])) return true;
  }
  return have('py', ['-3', '-c', 'pass']);
}
const HAVE_WORKING_PYTHON = haveWorkingPython();

const DEPS_OK = HAVE_BASH && HAVE_JQ;

function withFakeBin(files, fn) {
  const dir = fs.mkdtempSync(path.join(spTmpDir(), 'gate-python-fakebin-'));
  try {
    for (const [name, script] of Object.entries(files)) {
      const p = path.join(dir, name);
      fs.writeFileSync(p, script);
      fs.chmodSync(p, 0o755);
    }
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// A faithful stand-in for the Windows Store App Execution Alias: present on
// PATH, exits non-zero, prints a nag instead of running anything.
const STUB_PYTHON3 = '#!/bin/sh\necho "Python was not found; run without arguments to install from the Microsoft Store"\nexit 1\n';
// A real interpreter, but named `python` (not `python3`) — the actual shape
// of this bug on the machine it was diagnosed on.
const WORKING_PYTHON = '#!/bin/sh\nexit 0\n';
// A "runs but produces nothing useful" interpreter: succeeds on the probe
// (`-c pass` exits 0) but every real invocation prints `{}` regardless of
// the script/args it was given — simulating a parse that produced no
// `"parsed": true` sentinel.
const HOLLOW_PYTHON = '#!/bin/sh\necho \'{}\'\nexit 0\n';

describe('gate-hook python interpreter resolution (lib-python.sh)', () => {
  it('lib-python.sh exists', () => {
    expect(fs.existsSync(LIB)).toBe(true);
  });

  it.skipIf(!HAVE_BASH)(
    'sp_resolve_python skips a python3 stub that exits non-zero and falls back to a working `python`',
    () => {
      withFakeBin({ python3: STUB_PYTHON3, python: WORKING_PYTHON }, (fakeDir) => {
        const sandboxPath = [fakeDir, ...BASE_SANDBOX].join(path.delimiter);
        const r = spawnSync(
          'bash',
          ['-c', `source "$1"; if sp_resolve_python; then printf '%s\\n' "${'${SP_PYTHON[@]}'}"; else echo NONE; fi`, '_', LIB],
          { encoding: 'utf8', env: { ...process.env, PATH: sandboxPath } },
        );
        expect(r.status, `stdout:${r.stdout}\nstderr:${r.stderr}`).toBe(0);
        // Must NOT resolve to the stub — it must have been probed (`-c pass`)
        // and rejected, not merely found via `command -v`.
        expect(r.stdout.trim()).toBe('python');
      });
    },
  );

  it.skipIf(!HAVE_BASH)(
    'sp_resolve_python returns failure (no SP_PYTHON) when no interpreter works at all',
    () => {
      withFakeBin({ python3: STUB_PYTHON3 }, (fakeDir) => {
        const sandboxPath = [fakeDir, ...BASE_SANDBOX].join(path.delimiter);
        const r = spawnSync(
          'bash',
          ['-c', `source "$1"; if sp_resolve_python; then printf '%s\\n' "${'${SP_PYTHON[@]}'}"; else echo NONE; fi`, '_', LIB],
          { encoding: 'utf8', env: { ...process.env, PATH: sandboxPath } },
        );
        expect(r.status, `stdout:${r.stdout}\nstderr:${r.stderr}`).toBe(0);
        expect(r.stdout.trim()).toBe('NONE');
      });
    },
  );
});

// ---------------------------------------------------------------------
// Fixture builder shared by the fail-open and id-resolution integration
// tests below. Mirrors the transcript shape post-task-complete-revalidate.sh
// actually parses.
// ---------------------------------------------------------------------

function asstToolUse(id, name, input) {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  };
}
function asstText(text) {
  return { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } };
}
function toolResult(toolUseId, text) {
  return {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: text }] },
  };
}

const GATE_METADATA = JSON.stringify({ userGate: true, tags: ['user-gate'], acceptanceCriteria: ['it works'] });
const GATE_DESCRIPTION = ['USER-ORDERED GATE', '', '```json:metadata', GATE_METADATA, '```'].join('\n');

// A gate task created with real id 32 (via its tool_result, exactly as
// diagnosed: run #32-#81 in the session that surfaced this bug), moved
// in_progress, then closed WITHOUT evidence and WITHOUT a user message in
// the window — the block path, so the stderr message's resolved subject is
// observable proof that id resolution worked.
function buildHighIdTranscript() {
  const lines = [
    asstToolUse('toolu_create_32', 'TaskCreate', { subject: 'gate task 32', description: GATE_DESCRIPTION }),
    toolResult('toolu_create_32', 'Task #32 created successfully: gate task 32'),
    asstToolUse('toolu_upd_1', 'TaskUpdate', { taskId: '32', status: 'in_progress' }),
    asstText('Moving on to the next item.'),
    asstToolUse('toolu_upd_2', 'TaskUpdate', { taskId: '32', status: 'completed' }),
  ];
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

function withTranscript(build, fn) {
  const dir = fs.mkdtempSync(path.join(spTmpDir(), 'gate-python-fixture-'));
  const fp = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(fp, build());
  try {
    return fn(fp);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function postInput(transcriptPath, taskId) {
  return JSON.stringify({
    tool_name: 'TaskUpdate',
    tool_input: { taskId, status: 'completed' },
    transcript_path: transcriptPath,
  });
}

describe('post-task-complete-revalidate.sh fail-open contract (bug 2)', () => {
  it.skipIf(!DEPS_OK)(
    'exits 0 (does not block) when no python interpreter exists on PATH at all',
    () => {
      withFakeBin({}, (emptyBinDir) => {
        // No python* anywhere on this PATH — only bash/jq/node from the host.
        const sandboxPath = [emptyBinDir, ...BASE_SANDBOX].join(path.delimiter);
        withTranscript(buildHighIdTranscript, (fp) => {
          const traceLog = path.join(fs.mkdtempSync(path.join(spTmpDir(), 'gate-python-trace-')), 'trace.log');
          const r = spawnSync('bash', [POST_HOOK], {
            input: postInput(fp, '32'),
            encoding: 'utf8',
            env: { ...process.env, PATH: sandboxPath, SUPERPOWERS_USERGATE_GUARD: '1', SUPERPOWERS_USERGATE_TRACE_LOG: traceLog },
          });
          // This transcript would BLOCK (exit 2) under a working parse — no
          // evidence, no user message. With zero interpreters available the
          // hook has no information and must fail OPEN instead.
          expect(r.status, `stdout:${r.stdout}\nstderr:${r.stderr}`).toBe(0);
          const trace = fs.existsSync(traceLog) ? fs.readFileSync(traceLog, 'utf8') : '';
          expect(trace).toMatch(/no-python-interpreter/);
        });
      });
    },
  );

  it.skipIf(!DEPS_OK)(
    'exits 0 (does not block) when the interpreter runs but the parse carries no "parsed" sentinel',
    () => {
      withFakeBin({ python3: HOLLOW_PYTHON }, (fakeDir) => {
        const sandboxPath = [fakeDir, ...BASE_SANDBOX].join(path.delimiter);
        withTranscript(buildHighIdTranscript, (fp) => {
          const traceLog = path.join(fs.mkdtempSync(path.join(spTmpDir(), 'gate-python-trace-')), 'trace.log');
          const r = spawnSync('bash', [POST_HOOK], {
            input: postInput(fp, '32'),
            encoding: 'utf8',
            env: { ...process.env, PATH: sandboxPath, SUPERPOWERS_USERGATE_GUARD: '1', SUPERPOWERS_USERGATE_TRACE_LOG: traceLog },
          });
          expect(r.status, `stdout:${r.stdout}\nstderr:${r.stderr}`).toBe(0);
          const trace = fs.existsSync(traceLog) ? fs.readFileSync(traceLog, 'utf8') : '';
          expect(trace).toMatch(/parse-produced-no-result|parsed/);
        });
      });
    },
  );
});

describe('post-task-complete-revalidate.sh task-id resolution (bug 3)', () => {
  it.skipIf(!DEPS_OK || !HAVE_WORKING_PYTHON)(
    'reads the real id from the TaskCreate tool_result, not positional counting — subject resolves for id=32',
    () => {
      withTranscript(buildHighIdTranscript, (fp) => {
        const r = spawnSync('bash', [POST_HOOK], {
          input: postInput(fp, '32'),
          encoding: 'utf8',
          env: { ...process.env, SUPERPOWERS_USERGATE_GUARD: '1' },
        });
        // No evidence, no user message -> this IS the block path. The point
        // of this assertion is the resolved subject in the stderr, not the
        // exit code itself: under the old positional counter, task_id "32"
        // never matches next_id "1" (the only TaskCreate in the transcript),
        // so description/subject stay empty and the message falls back to
        // "(unknown)".
        expect(r.status, `stdout:${r.stdout}\nstderr:${r.stderr}`).toBe(2);
        expect(r.stderr).toContain("Task #32 ('gate task 32')");
        expect(r.stderr).not.toContain('(unknown)');
      });
    },
  );
});
