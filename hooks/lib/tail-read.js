// hooks/lib/tail-read.js — bounded tail of a log file.
//
// The statusline runs on every assistant message, and hooks-logs/claude-usage.jsonl
// is append-only and unrotated. Reading a whole file on that path is a latent
// stall, so every consumer takes a fixed window from the end instead.
import fs from 'fs';

/**
 * Last complete lines of `file`, reading at most `maxBytes` from the end.
 * Returns [] on any fault — callers are on a hot path and must not branch on errors.
 */
function tailLines(file, maxBytes = 8192) {
  let fd;
  try {
    const size = fs.statSync(file).size;
    if (size === 0) return [];
    const want = Math.min(size, maxBytes);
    const buf = Buffer.alloc(want);
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, want, size - want);
    let text = buf.toString('utf8');
    // A window that starts mid-record yields a fragment; drop it rather than
    // handing a caller a half-parsed line.
    if (want < size) {
      const nl = text.indexOf('\n');
      text = nl === -1 ? '' : text.slice(nl + 1);
    }
    return text.split('\n').filter((l) => l.length > 0);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  }
}

export { tailLines };
