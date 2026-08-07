import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spTmpDir } from '../hooks/lib/sp-tmp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRACK_EDITS = path.resolve(__dirname, '../hooks/track-edits.js');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(spTmpDir(), prefix));
}

describe('telemetry log root honors CLAUDE_CONFIG_DIR', () => {
  let profileDir, homeDir;
  beforeEach(() => {
    profileDir = tmpDir('sp-profile-');
    homeDir = tmpDir('sp-home-');
  });
  afterEach(() => {
    fs.rmSync(profileDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('writes track-edits.js logs under CLAUDE_CONFIG_DIR/hooks-logs, not $HOME/.claude', () => {
    const target = path.join(homeDir, 'some-file.txt');
    const res = spawnSync('node', [TRACK_EDITS], {
      input: JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: target },
        session_id: 's1',
        cwd: homeDir,
      }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CONFIG_DIR: profileDir, HOME: homeDir, USERPROFILE: homeDir },
    });

    expect(res.stdout).toBe('{}');
    expect(fs.existsSync(path.join(profileDir, 'hooks-logs', 'edit-log.txt'))).toBe(true);
    expect(fs.existsSync(path.join(homeDir, '.claude', 'hooks-logs', 'edit-log.txt'))).toBe(false);
  });
});
