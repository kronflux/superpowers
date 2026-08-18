import { describe, it, expect } from 'vitest';
import { validateCommitMessage } from '../hooks/lib/conventional-commit.js';
import { findBannedContent } from '../hooks/lib/commit-content.js';
import { extractCommitMessage } from '../hooks/lib/commit-command.js';

const rules = (m) => validateCommitMessage(m).map(f => f.rule);
const banned = (d, b) => findBannedContent(d, b).map(f => f.rule);

describe('conventional commit format', () => {
  it('accepts a type, a colon, and a description', () => {
    expect(rules('feat: add the commit gate')).toEqual([]);
  });

  it('accepts an optional scope and a breaking-change marker', () => {
    expect(rules('fix(parser)!: reject an empty scope')).toEqual([]);
  });

  it('accepts every type the shared config defines', () => {
    for (const t of ['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'style', 'test']) {
      expect(rules(`${t}: describe the change`), t).toEqual([]);
    }
  });

  it('rejects a message with no type prefix', () => {
    expect(rules('updated the parser')).toContain('header-format');
  });

  it('rejects a type outside the set', () => {
    expect(rules('update: the parser')).toContain('type-enum');
  });

  it('rejects an upper-case type', () => {
    expect(rules('Feat: add the gate')).toContain('type-case');
  });

  it('rejects a sentence-case description', () => {
    expect(rules('feat: Add the gate')).toContain('subject-case');
  });

  it('rejects a trailing full stop', () => {
    expect(rules('feat: add the gate.')).toContain('subject-full-stop');
  });

  it('rejects an empty description', () => {
    expect(rules('feat: ')).toContain('subject-empty');
  });

  it('rejects an empty scope', () => {
    expect(rules('feat(): add the gate')).toContain('scope-empty');
  });

  it('rejects a header over 100 characters', () => {
    expect(rules(`feat: ${'x'.repeat(120)}`)).toContain('header-max-length');
  });

  it('requires a blank line before the body', () => {
    expect(rules('feat: add the gate\nthe body starts immediately')).toContain('body-leading-blank');
    expect(rules('feat: add the gate\n\nthe body starts after a blank line')).toEqual([]);
  });

  it('requires the BREAKING CHANGE token to be upper-case', () => {
    expect(rules('feat: add the gate\n\nBreaking change: config moved')).toContain('breaking-change-case');
    expect(rules('feat: add the gate\n\nBREAKING CHANGE: config moved')).toEqual([]);
  });

  it('ignores comment lines and the verbose diff git strips', () => {
    expect(rules('feat: add the gate\n\n# a comment git removes')).toEqual([]);
  });
});

describe('banned commit content', () => {
  it('rejects a reference to a numbered task or phase', () => {
    expect(banned('add the gate per Task 3')).toContain('planning-task-reference');
  });

  it('rejects a reference to the plan or spec that produced the change', () => {
    expect(banned('add the gate per the plan')).toContain('planning-structure');
  });

  it('rejects an internal count', () => {
    expect(banned('add 11 categories of checks')).toContain('internal-counts');
  });

  it('rejects measurement reported as achievement', () => {
    expect(banned('add the gate, all tests passing')).toContain('measurement-as-achievement');
  });

  it('rejects a description opening with a verb about your own motion', () => {
    expect(banned('derive the pattern set')).toContain('process-verbs');
  });

  it('allows domain language that merely contains a step or phase number', () => {
    expect(banned('retry step 2 of the OAuth handshake')).toEqual([]);
    expect(banned('add a 3-phase migration path')).toEqual([]);
  });

  it('allows a description naming counts that belong to the software', () => {
    expect(banned('raise the retry limit to 5 attempts')).toEqual([]);
  });
});

describe('commit command extraction', () => {
  it('reads the message from -m', () => {
    expect(extractCommitMessage('git commit -m "feat: add it"')).toEqual({ kind: 'message', text: 'feat: add it' });
  });

  it('joins repeated -m values into paragraphs the way git does', () => {
    expect(extractCommitMessage('git commit -m "feat: add it" -m "the body"'))
      .toEqual({ kind: 'message', text: 'feat: add it\n\nthe body' });
  });

  it('reports no inline message for an editor-driven commit', () => {
    expect(extractCommitMessage('git commit')).toEqual({ kind: 'none' });
  });

  it('reports no inline message for --amend --no-edit', () => {
    expect(extractCommitMessage('git commit --amend --no-edit')).toEqual({ kind: 'none' });
  });

  it('reports no inline message when the text comes from a file', () => {
    expect(extractCommitMessage('git commit -F /tmp/msg.txt')).toEqual({ kind: 'none' });
  });

  it('reports absent when the command does not commit', () => {
    expect(extractCommitMessage('git status --porcelain')).toEqual({ kind: 'absent' });
  });

  it('does not read a message out of a heredoc body', () => {
    const cmd = 'cat <<EOF\ngit commit -m "updated the parser"\nEOF';
    expect(extractCommitMessage(cmd)).toEqual({ kind: 'absent' });
  });

  it('finds a commit later in a chained command', () => {
    expect(extractCommitMessage('git add -- a.js && git commit -m "fix: repair a.js"'))
      .toEqual({ kind: 'message', text: 'fix: repair a.js' });
  });
});
