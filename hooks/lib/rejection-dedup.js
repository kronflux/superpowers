// hooks/lib/rejection-dedup.js — collapses repeated identical rejection
// explanations within one session.
//
// A blocking hook's explanation is long because it has to teach the rule. Six
// tool calls failing the same rule emit that explanation six times, burying
// the one thing that differs between them: which subject failed. The first
// rejection for a rule teaches; later ones name the subject and refer back.
//
// The decision is never affected — only the text of the reason.

import fs from 'fs';
import { spTmp } from './sp-tmp.js';

/** Absolute path to the per-session, per-rule marker inside the sp/ temp root. */
function markerPath(sessionId, hook, ruleId) {
  return spTmp(`reject-${sessionId || 'default'}-${hook}-${ruleId}`);
}

/**
 * The full reason on the first rejection of this rule in this session, a
 * single line naming the subject afterwards. Returns the full reason on any
 * internal fault, so a storage failure costs verbosity rather than clarity.
 * A missing session id never dedupes: without a session to key on, treating
 * two unrelated calls as the same session would be a false collapse rather
 * than a fault, so this returns the full reason instead of guessing.
 */
function dedupeReason({ sessionId, hook, ruleId, reason, subject }) {
  if (!sessionId) return reason;
  try {
    fs.writeFileSync(markerPath(sessionId, hook, ruleId), '1', { flag: 'wx' });
    return reason;
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      const first = String(reason).split('\n')[0];
      return `[${ruleId}] ${first} - for '${subject}'. Full explanation was given for the first task that failed this rule in this session.`;
    }
    return reason;
  }
}

export { markerPath, dedupeReason };
