import fs from 'fs';
import path from 'path';

const SECTION_HEADER = '# AI assistant artifacts';

/**
 * Idempotently ensure that the given entries live under the shared
 * "# AI assistant artifacts" section of <cwd>/.gitignore.
 *
 * Shared by context-engine.js (context-snapshot.json) and track-edits.js
 * (its own artifacts). Both MUST call this helper so the section header is
 * written exactly once and no entry is duplicated.
 *
 * - The section header is added only if absent.
 * - Each entry is added only if not already present (exact-line match,
 *   whitespace-trimmed).
 * - Fail-silent: never throws — never blocks a hook.
 *
 * @param {string} cwd     project root containing (or to contain) .gitignore
 * @param {string[]} entries lines to ensure are ignored
 */
function ensureGitignored(cwd, entries) {
  try {
    const gitignorePath = path.join(cwd, '.gitignore');
    let content = fs.existsSync(gitignorePath)
      ? fs.readFileSync(gitignorePath, 'utf8')
      : '';

    const existing = new Set(content.split('\n').map(l => l.trim()));
    const missing = entries.filter(e => !existing.has(e.trim()));
    if (missing.length === 0) return; // all present

    const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    const hasSection = existing.has(SECTION_HEADER);

    const addition = hasSection
      ? missing.join('\n') + '\n'
      : `\n${SECTION_HEADER}\n` + missing.join('\n') + '\n';

    fs.appendFileSync(gitignorePath, prefix + addition);
  } catch {
    // Silently ignore — never block a hook
  }
}

export { ensureGitignored, SECTION_HEADER };
