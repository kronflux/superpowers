// hooks/lib/command-segments.js — normalizes a shell command string for
// pattern matching.
//
// Heredoc bodies and quoted argument bodies are command *data*, not command
// structure: a 2,000-character commit message scanned as command text
// produces matches that describe the prose, not the action. Both are removed
// before any pattern runs, which also makes operator splitting safe, since
// every remaining `&&`, `||`, `;` and `|` is a real shell operator.
//
// Subshells (`$( )`, backticks), `bash -c` and `eval` bodies are not
// descended into.

// A heredoc opener: `<<` or `<<-`, an optional quote, a word, the matching
// quote. The body runs to a line containing only that word.
const HEREDOC_OPEN = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/;

/**
 * Replaces every heredoc body with the literal token `<<HEREDOC`. A heredoc
 * whose terminator never appears consumes the rest of the string.
 */
function stripHeredocs(cmd) {
  let result = '';
  let remaining = String(cmd);

  while (true) {
    const match = HEREDOC_OPEN.exec(remaining);
    if (!match) {
      result += remaining;
      break;
    }

    result += remaining.slice(0, match.index);

    const word = match[2];
    const after = match.index + match[0].length;
    const term = new RegExp(`^[ \\t]*${word}[ \\t]*$`, 'm');
    const rest = remaining.slice(after);
    const end = term.exec(rest);

    result += '<<HEREDOC';

    if (end === null) {
      break;
    } else {
      remaining = rest.slice(end.index + end[0].length);
    }
  }

  return result;
}

/**
 * Replaces every single- or double-quoted body, and its delimiters, with the
 * literal token `ARG`. A backslash escapes the next character while a double
 * quote is open. An unterminated quote runs to the end of the string.
 */
function stripQuoted(cmd) {
  const s = String(cmd);
  let out = '';
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (quote === '"' && ch === '\\') { i++; continue; }
      if (ch === quote) { quote = null; out += 'ARG'; }
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    out += ch;
  }
  if (quote) out += 'ARG';
  return out;
}

/** Heredoc bodies and quoted bodies removed, whitespace collapsed, trimmed. */
function normalizeCommand(cmd) {
  return stripQuoted(stripHeredocs(cmd)).replace(/\s+/g, ' ').trim();
}

/**
 * The command split on unquoted `&&`, `||`, `;`, `|`, `&` and newline.
 * Heredoc bodies and quoted bodies are removed first, so every remaining
 * newline is a command separator rather than data. `&&` precedes `&` in the
 * alternation, so it is consumed as one operator, never as two `&`
 * separators. A bare `&` separates commands except where it forms part of a
 * redirect such as `2>&1` or `&>` — it is not treated as a separator when
 * immediately preceded by `<` or `>`, or immediately followed by `>`. A
 * backslash-newline line continuation is joined before splitting, since it
 * continues one command — an escaped backslash (an odd number of trailing
 * backslashes) does not count. Empty segments are dropped and each segment's
 * internal whitespace is collapsed.
 */
function splitSegments(cmd) {
  return stripQuoted(stripHeredocs(cmd))
    .replace(/(?<!\\)\\\r?\n/g, ' ')
    .split(/\s*(?:&&|\|\||;|\||(?<![<>])&(?!>)|\r?\n)\s*/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export { stripHeredocs, stripQuoted, splitSegments, normalizeCommand };
