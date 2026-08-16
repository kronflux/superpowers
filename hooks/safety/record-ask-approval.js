#!/usr/bin/env node
/**
 * Record Ask Approval — PostToolUse hook for Bash.
 *
 * PostToolUse fires only after a tool executes, so a Bash command that
 * matched an ASK pattern and reached this hook is one the operator approved.
 * Its normalized form is appended to the session allowlist that
 * block-dangerous-commands.js reads before asking again.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { recordAllowed } from '../lib/ask-allowlist.js';
import { checkAsk } from './block-dangerous-commands.js';

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  try {
    const data = JSON.parse(input);
    const { tool_name, tool_input, session_id, cwd } = data;
    if (tool_name === 'Bash') {
      const cmd = tool_input?.command || '';
      if (checkAsk(cmd, { repoRoot: cwd }).ask) recordAllowed(session_id, cmd);
    }
  } catch {
    // Fail open
  }
  process.stdout.write('{}');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main();
}
