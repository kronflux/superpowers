import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { check, findViolation, addedLines, buildDenyMessage } from '../hooks/comment-gate.js';
import { classifyComment, extractComments } from '../hooks/lib/comment-patterns.js';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';
import { markerPath } from '../hooks/lib/rejection-dedup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = path.resolve(__dirname, '../hooks/comment-gate.js');
const GATE_SOURCE = path.resolve(__dirname, '../hooks/comment-gate.js');
const TEST_SOURCE = path.resolve(__dirname, '../tests/comment-gate.test.js');

function mkProjectDir() {
  return fs.mkdtempSync(path.join(spTmpDir(), 'comment-gate-'));
}

function runHook(payload) {
  const res = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  return JSON.parse(res.stdout || '{}');
}

describe('comment-gate: Write introducing a narration comment', () => {
  it('denies a Write whose content introduces a narration comment', () => {
    const dir = mkProjectDir();
    const file = path.join(dir, 'new.js');
    const r = check('Write', {
      file_path: file,
      content: 'function f() {}\n// Added retry logic to handle unstable network\n',
    }, dir);
    expect(r.blocked).toBe(true);
    expect(r.violation.violation).toBe('narration');
  });

  it('denies a Write whose content introduces an impermanence comment', () => {
    const dir = mkProjectDir();
    const file = path.join(dir, 'new.js');
    const r = check('Write', {
      file_path: file,
      content: '// TODO: revisit after migration\nfunction f() {}\n',
    }, dir);
    expect(r.blocked).toBe(true);
    expect(r.violation.violation).toBe('impermanence');
  });
});

describe('comment-gate: Edit introducing a narration comment', () => {
  it('denies an Edit whose new_string introduces a narration comment', () => {
    const dir = mkProjectDir();
    const r = check('Edit', {
      file_path: path.join(dir, 'x.js'),
      old_string: 'const a = 1;',
      new_string: '// Refactored to support multi-tenant user IDs\nconst a = 2;',
    }, dir);
    expect(r.blocked).toBe(true);
    expect(r.violation.violation).toBe('narration');
  });
});

describe('comment-gate: added-lines-only scoping', () => {
  it('allows an Edit that is a plain change with no comments', () => {
    const dir = mkProjectDir();
    const r = check('Edit', {
      file_path: path.join(dir, 'x.js'),
      old_string: 'const a = 1;',
      new_string: 'const a = 2;',
    }, dir);
    expect(r.blocked).toBe(false);
  });

  it('allows an Edit that carries an unrelated violation forward unchanged as context', () => {
    // old_string and new_string both include the same deferred-marker line
    // because Edit requires surrounding context for a unique match. Only the
    // changed line (const a = 2;) is in scope; the unchanged line is not.
    const dir = mkProjectDir();
    const r = check('Edit', {
      file_path: path.join(dir, 'x.js'),
      old_string: '// TODO: revisit later\nconst a = 1;',
      new_string: '// TODO: revisit later\nconst a = 2;',
    }, dir);
    expect(r.blocked).toBe(false);
  });

  it('allows a Write that carries an existing on-disk violation forward unchanged', () => {
    const dir = mkProjectDir();
    const file = path.join(dir, 'x.js');
    fs.writeFileSync(file, '// TODO: revisit later\nconst a = 1;\n');
    const r = check('Write', {
      file_path: file,
      content: '// TODO: revisit later\nconst a = 1;\nconst b = 2;\n',
    }, dir);
    expect(r.blocked).toBe(false);
  });

  it('denies a Write that adds a new violation alongside an unchanged old one', () => {
    const dir = mkProjectDir();
    const file = path.join(dir, 'x.js');
    fs.writeFileSync(file, '// TODO: revisit later\nconst a = 1;\n');
    const r = check('Write', {
      file_path: file,
      content: '// TODO: revisit later\nconst a = 1;\n// Added retry logic to handle unstable network\nconst b = 2;\n',
    }, dir);
    expect(r.blocked).toBe(true);
    expect(r.violation.match).toMatch(/added/i);
  });
});

describe('comment-gate: GOOD examples from the spec', () => {
  const GOOD = [
    'Executes network request with 3 exponential backoff retries',
    'Retrieves user records isolated by the specified tenant ID',
    'Returns cached configuration data if the primary database connection fails.',
    'Generates a static JWT payload for unauthenticated sessions.',
    'Calculates the absolute sum of the array. Only supports positive integers.',
    'Parses the XML payload using exact string matching. Does not validate XML schema.',
    'Matches forward commitments in an assistant\'s final message.',
    'Patterns require sentence-initial or first-person position.',
    '"moving on to" is not matched: it is a paragraph transition, not a commitment.',
    'Fixed entries have strikethrough: ## ~~...~~',
    'Fixed session key so the test client can authenticate',
  ];

  it.each(GOOD)('allows a Write introducing: %s', (line) => {
    const dir = mkProjectDir();
    const file = path.join(dir, 'good.js');
    const r = check('Write', { file_path: file, content: `// ${line}\n` }, dir);
    expect(r.blocked, line).toBe(false);
  });
});

describe('comment-gate: decline marker', () => {
  it('allows everything when .superpowers-no-comment-gate exists at the project root', () => {
    const dir = mkProjectDir();
    fs.writeFileSync(path.join(dir, '.superpowers-no-comment-gate'), '');
    const r = check('Write', {
      file_path: path.join(dir, 'new.js'),
      content: '// TODO: revisit after migration\n',
    }, dir);
    expect(r.blocked).toBe(false);
  });
});

describe('comment-gate: fail open', () => {
  it('allows when tool_input is missing entirely', () => {
    const dir = mkProjectDir();
    const r = check('Write', undefined, dir);
    expect(r.blocked).toBe(false);
  });

  it('allows when content is not a string', () => {
    const dir = mkProjectDir();
    const r = check('Write', { file_path: path.join(dir, 'x.js'), content: 42 }, dir);
    expect(r.blocked).toBe(false);
  });

  it('allows a tool this hook does not cover', () => {
    const dir = mkProjectDir();
    const r = check('Read', { file_path: path.join(dir, 'x.js') }, dir);
    expect(r.blocked).toBe(false);
  });

  it('allows on malformed JSON from stdin', () => {
    const res = spawnSync('node', [HOOK_PATH], { input: 'not json', encoding: 'utf8' });
    expect(JSON.parse(res.stdout || '{}')).toEqual({});
  });
});

describe('comment-gate: deny message', () => {
  it('quotes the matched text and names the disable path', () => {
    const msg = buildDenyMessage({ violation: 'narration', match: 'was broadened' });
    expect(msg).toContain('matched: "was broadened"');
    expect(msg).toContain('.superpowers-no-comment-gate');
  });
});

describe('comment-gate: end-to-end via stdin', () => {
  it('denies a Write with a narration comment through the real hook process', () => {
    const dir = mkProjectDir();
    const out = runHook({
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, 'e2e.js'), content: '// Added retry logic to handle unstable network\n' },
      cwd: dir,
    });
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('matched:');
  });

  it('allows an unrelated Edit through the real hook process', () => {
    const dir = mkProjectDir();
    const out = runHook({
      tool_name: 'Edit',
      tool_input: { file_path: path.join(dir, 'e2e.js'), old_string: 'const a = 1;', new_string: 'const a = 2;' },
      cwd: dir,
    });
    expect(out).toEqual({});
  });
});

describe('comment-gate: self-application', () => {
  it('classifyComment returns null for every comment in comment-gate.js and this test file', () => {
    const flagged = [];
    for (const file of [GATE_SOURCE, TEST_SOURCE]) {
      const text = fs.readFileSync(file, 'utf8');
      for (const body of extractComments(text)) {
        const result = classifyComment(body);
        if (result) flagged.push({ file, body, result });
      }
    }
    expect(flagged).toEqual([]);
  });
});

describe('comment-gate: dedupeReason wiring end-to-end', () => {
  it('emits the full reason once per session, then a single line naming the subject', () => {
    const dir = mkProjectDir();
    const sessionId = `dd-cg-${process.pid}-${Math.random().toString(36).slice(2)}`;
    const marker = markerPath(sessionId, 'comment-gate', 'narration');
    try {
      const first = runHook({
        session_id: sessionId,
        tool_name: 'Write',
        tool_input: {
          file_path: path.join(dir, 'a.js'),
          content: '// Added retry logic to handle unstable network\n',
        },
        cwd: dir,
      });
      const reason1 = first.hookSpecificOutput.permissionDecisionReason;
      expect(reason1.split('\n').length).toBeGreaterThan(1);
      expect(reason1).toContain('matched:');

      const second = runHook({
        session_id: sessionId,
        tool_name: 'Write',
        tool_input: {
          file_path: path.join(dir, 'b.js'),
          content: '// Added retry logic to handle unstable network\n',
        },
        cwd: dir,
      });
      const reason2 = second.hookSpecificOutput.permissionDecisionReason;
      expect(reason2.split('\n')).toHaveLength(1);
      expect(reason2).toContain('narration');
      expect(reason2).toContain(path.join(dir, 'b.js'));
    } finally {
      fs.rmSync(marker, { force: true });
    }
  });
});

describe('comment-gate: internal helpers', () => {
  it('addedLines returns only lines absent from oldText, honoring duplicate counts', () => {
    expect(addedLines('a\nb\n', 'a\nb\nc\n')).toEqual(['c']);
    expect(addedLines('a\na\n', 'a\n')).toEqual([]);
  });

  it('findViolation is null when no added line contains a comment', () => {
    expect(findViolation('const a = 1;', 'const a = 2;')).toBeNull();
  });
});
