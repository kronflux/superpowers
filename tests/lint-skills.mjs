#!/usr/bin/env node
// Usage: node tests/lint-skills.mjs [skills/<name> ...]  (default: all skills/*)
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const BLOCKED = [
  /\bcurl\b/i, /\bwget\b/i, /\bWebFetch\b/, /fetch\(['"]http/i,
  /requests\.(get|post|put)\(/i, /\bRead directly\b/i, /\bGrep to locate\b/i,
];
const ALLOW_CONTEXT = [
  /context-mode-adapter\.md/i, /when inactive/i, /native fallback/i,
  /ctx_fetch_and_index/i,
];
const BAD_NS = /superpowers-(extended-cc|optimized):/g;

function lintDir(dir) {
  const md = join(dir, "SKILL.md");
  if (!existsSync(md)) return { dir, errors: [`missing SKILL.md`] };
  const src = readFileSync(md, "utf8");
  const errors = [];

  const fm = src.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) errors.push("no YAML frontmatter");
  else {
    if (fm[1].length > 1024) errors.push("frontmatter >1024 chars");
    if (!/\bname:/.test(fm[1])) errors.push("frontmatter missing name");
    if (!/\bdescription:/.test(fm[1])) errors.push("frontmatter missing description");
  }

  const ns = src.match(BAD_NS);
  if (ns) errors.push(`non-superpowers namespace: ${[...new Set(ns)].join(", ")}`);

  src.split("\n").forEach((line, i) => {
    if (ALLOW_CONTEXT.some((r) => r.test(line))) return;
    for (const r of BLOCKED) {
      if (r.test(line)) errors.push(`blocked fetch pattern line ${i + 1}: ${r}`);
    }
  });

  return { dir, errors };
}

const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync("skills").filter((n) => n !== "shared").map((n) => join("skills", n)).filter((p) => statSync(p).isDirectory());

let failed = false;
for (const t of targets) {
  const { dir, errors } = lintDir(t);
  const name = dir.replace(/^skills\//, "");
  if (errors.length) { failed = true; console.error(`${name}: FAIL\n  - ${errors.join("\n  - ")}`); }
  else console.log(`${name}: frontmatter OK; cross-refs OK; no blocked fetch patterns`);
}
process.exit(failed ? 1 : 0);
