import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const UPDATE_CACHE_TTL_MS = 5 * 60 * 1000;
const updateCheckCache = new Map();

function stripMatchingQuotes(value) {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

function parseFrontmatter(content) {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) return {};
  const parsed = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIndex = line.indexOf(':');
    if (colonIndex <= 0) continue;
    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();
    if (value === '>' || value === '|') {
      const folded = value === '>';
      const blockLines = [];
      while (i + 1 < lines.length && lines[i + 1].match(/^[ \t]/)) {
        i++;
        blockLines.push(lines[i].trim());
      }
      parsed[key] = folded ? blockLines.join(' ') : blockLines.join('\n');
      continue;
    }
    value = stripMatchingQuotes(value);
    parsed[key] = value;
  }
  return parsed;
}

function extractFrontmatter(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const frontmatter = parseFrontmatter(content);
    return { name: frontmatter.name || '', description: frontmatter.description || '' };
  } catch {
    return { name: '', description: '' };
  }
}

function findSkillsInDir(dir, sourceType, maxDepth = 3) {
  const skills = [];
  if (!fs.existsSync(dir)) return skills;
  function recurse(currentDir, depth) {
    if (depth > maxDepth) return;
    let entries = [];
    try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      const skillFile = path.join(fullPath, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        const { name, description } = extractFrontmatter(skillFile);
        skills.push({ path: fullPath, skillFile, name: name || entry.name, description: description || '', sourceType });
        continue;
      }
      recurse(fullPath, depth + 1);
    }
  }
  recurse(dir, 0);
  return skills;
}

function resolveSkillPath(skillName, superpowersDir, personalDir) {
  const forceSuperpowers = skillName.startsWith('superpowers:');
  const actualSkillName = forceSuperpowers ? skillName.replace(/^superpowers:/, '') : skillName;
  if (!forceSuperpowers && personalDir) {
    const personalSkillFile = path.join(personalDir, actualSkillName, 'SKILL.md');
    if (fs.existsSync(personalSkillFile)) {
      return { skillFile: personalSkillFile, sourceType: 'personal', skillPath: actualSkillName };
    }
  }
  if (superpowersDir) {
    const superpowersSkillFile = path.join(superpowersDir, actualSkillName, 'SKILL.md');
    if (fs.existsSync(superpowersSkillFile)) {
      return { skillFile: superpowersSkillFile, sourceType: 'superpowers', skillPath: actualSkillName };
    }
  }
  return null;
}

function checkForUpdates(repoDir) {
  if (!repoDir || !fs.existsSync(repoDir)) return false;
  const now = Date.now();
  const cached = updateCheckCache.get(repoDir);
  if (cached && (now - cached.checkedAt) < UPDATE_CACHE_TTL_MS) return cached.hasUpdates;
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    updateCheckCache.set(repoDir, { checkedAt: now, hasUpdates: false });
    return false;
  }
  try {
    execSync('git remote get-url origin', { cwd: repoDir, timeout: 1000, stdio: 'pipe' });
    execSync('git fetch --quiet origin', { cwd: repoDir, timeout: 3000, stdio: 'pipe' });
    const output = execSync('git status --porcelain=v1 --branch', { cwd: repoDir, timeout: 1000, encoding: 'utf8', stdio: 'pipe' });
    const hasUpdates = output.split('\n').some((line) => line.startsWith('## ') && line.includes('[behind '));
    updateCheckCache.set(repoDir, { checkedAt: now, hasUpdates });
    return hasUpdates;
  } catch {
    updateCheckCache.set(repoDir, { checkedAt: now, hasUpdates: false });
    return false;
  }
}

function stripFrontmatter(content) {
  if (typeof content !== 'string') return '';
  return content.replace(FRONTMATTER_REGEX, '').trim();
}

export { extractFrontmatter, findSkillsInDir, resolveSkillPath, checkForUpdates, stripFrontmatter };
