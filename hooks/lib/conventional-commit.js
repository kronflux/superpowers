// hooks/lib/conventional-commit.js — Conventional Commits 1.0.0 validation.
//
// Rules follow the specification at conventionalcommits.org/en/v1.0.0 and the
// type list and length limits from @commitlint/config-conventional. Pure text
// in, structured findings out; no filesystem or process access.

const TYPES = [
  'build', 'chore', 'ci', 'docs', 'feat', 'fix',
  'perf', 'refactor', 'revert', 'style', 'test',
];

const MAX_HEADER = 100;
const MAX_LINE = 100;

// type, optional (scope), optional !, then a required colon and single space.
const HEADER_RE = /^([a-zA-Z]+)(\(([^()]*)\))?(!)?: (.*)$/;

/** The first line of a message, with any trailing carriage return removed. */
function headerOf(message) {
  return String(message ?? '').split(/\r?\n/)[0] ?? '';
}

/**
 * Comment lines git strips before storing a message, plus the diff block
 * `commit --verbose` appends. Neither reaches the stored commit, so neither
 * is validated.
 */
function significantLines(message) {
  const lines = String(message ?? '').split(/\r?\n/);
  const cut = lines.findIndex(l => l.startsWith('# ------------------------ >8'));
  return (cut === -1 ? lines : lines.slice(0, cut)).filter(l => !l.startsWith('#'));
}

/**
 * Findings for one commit message, in the order a reader should fix them.
 * An empty array means the message conforms. Each finding carries `rule` for
 * dedupe keying and `detail` for the reader.
 */
function validateCommitMessage(message) {
  const findings = [];
  const lines = significantLines(message);
  const header = lines[0] ?? '';

  if (header.trim() === '') {
    return [{ rule: 'header-empty', detail: 'The message is empty.' }];
  }

  const m = HEADER_RE.exec(header);
  if (!m) {
    findings.push({
      rule: 'header-format',
      detail: `"${header}" is not "type(scope): description". A type, a colon, and a space are required.`,
    });
    return findings;
  }

  const [, type, , scope, , subject] = m;

  if (type !== type.toLowerCase()) {
    findings.push({ rule: 'type-case', detail: `Type "${type}" must be lower-case.` });
  }
  if (!TYPES.includes(type.toLowerCase())) {
    findings.push({
      rule: 'type-enum',
      detail: `Type "${type}" is not one of: ${TYPES.join(', ')}.`,
    });
  }
  if (scope !== undefined && scope.trim() === '') {
    findings.push({ rule: 'scope-empty', detail: 'A scope is present but empty. Write a noun or drop the parentheses.' });
  }
  if (subject.trim() === '') {
    findings.push({ rule: 'subject-empty', detail: 'The description after the colon is empty.' });
  }
  if (subject.endsWith('.')) {
    findings.push({ rule: 'subject-full-stop', detail: 'The description must not end with a full stop.' });
  }
  if (/^[A-Z][a-z]/.test(subject)) {
    findings.push({
      rule: 'subject-case',
      detail: `The description must not be sentence-case. Write "${subject.charAt(0).toLowerCase()}${subject.slice(1)}".`,
    });
  }
  if (header.length > MAX_HEADER) {
    findings.push({
      rule: 'header-max-length',
      detail: `The first line is ${header.length} characters; the limit is ${MAX_HEADER}.`,
    });
  }
  if (lines.length > 1 && lines[1].trim() !== '') {
    findings.push({ rule: 'body-leading-blank', detail: 'A blank line must separate the description from the body.' });
  }

  const longBodyLine = lines.slice(1).find(l => l.length > MAX_LINE);
  if (longBodyLine !== undefined) {
    findings.push({
      rule: 'body-max-line-length',
      detail: `A body line is ${longBodyLine.length} characters; the limit is ${MAX_LINE}.`,
    });
  }

  // BREAKING CHANGE is the one case-sensitive token in the specification.
  const badBreaking = lines.slice(1).find(l => /^breaking[ -]change:/i.test(l) && !/^BREAKING[ -]CHANGE:/.test(l));
  if (badBreaking !== undefined) {
    findings.push({
      rule: 'breaking-change-case',
      detail: 'The BREAKING CHANGE footer token must be upper-case.',
    });
  }

  return findings;
}

export { validateCommitMessage, headerOf, significantLines, TYPES, MAX_HEADER, MAX_LINE };
