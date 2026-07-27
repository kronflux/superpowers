import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHIM = path.resolve(__dirname, '../scripts/resolve-plugin-script.sh');

const bashAvailable = spawnSync('bash', ['--version']).status === 0;

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cacheBase(configDir) {
  return path.join(configDir, 'plugins', 'cache', 'superpowers-dev', 'superpowers');
}

function writeMarker(configDir, version) {
  const dir = path.join(cacheBase(configDir), version);
  fs.mkdirSync(dir, { recursive: true });
  const marker = path.join(dir, 'marker.sh');
  fs.writeFileSync(marker, `#!/usr/bin/env bash\necho "${version}"\n`);
  fs.chmodSync(marker, 0o755);
}

describe('resolve-plugin-script.sh', () => {
  let configDir;

  beforeEach(() => {
    configDir = tmpDir('sp-resolve-');
  });

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it.skipIf(!bashAvailable)('resolves the highest semver version directory via sort -V', () => {
    writeMarker(configDir, '6.6.2');
    writeMarker(configDir, '7.0.0');
    writeMarker(configDir, '7.1.0');

    const res = spawnSync('bash', [SHIM, 'marker.sh'], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    });

    expect(res.stdout.trim()).toBe('7.1.0');
    expect(res.status).toBe(0);
  });

  it.skipIf(!bashAvailable)('exits 127 with a one-line stderr message when no version is installed', () => {
    const res = spawnSync('bash', [SHIM, 'marker.sh'], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    });

    expect(res.status).toBe(127);
    expect(res.stderr.trim().split('\n')).toHaveLength(1);
  });
});
