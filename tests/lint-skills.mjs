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
  // "don't do this" callouts are not fetch instructions.
  /hard-denied/i, /\bblocked\b/i, /\bnever\b/i, /\bdon'?t\b/i,
];
const BAD_NS = /superpowers-(extended-cc|optimized):/g;

// Conductor tool-selection sweep (Task 13): every swept SKILL.md must defer to the
// canonical sentence instead of restating a legacy per-skill ctx tool-selection chain.
const CANONICAL_SENTENCE = /Tool selection is governed by `\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/shared\/conductor\/routing\.md`/;
const LEGACY_CHAIN = /ctx_fetch_and_index.*ctx_search|route data work.*ctx_/i;

// Context economy budgets (Task 12).
const DESCRIPTION_BUDGET = 300; // bytes, FAIL above
const SKILL_SIZE_BUDGET = 12288; // bytes, WARN above
// A skill may only reference files at most one level below its own dir
// (e.g. references/x.md) — nested trees hide content from maintenance.
const DEEP_REF = /\b(?:references|examples|scripts|assets)\/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+/g;

function descriptionBytes(fm) {
  const lines = fm.split(/\r?\n/);
  const i = lines.findIndex((l) => /^description:/.test(l));
  if (i === -1) return 0;
  const block = [lines[i].replace(/^description:\s*/, "")];
  for (let j = i + 1; j < lines.length; j++) {
    if (/^[A-Za-z_-]+:/.test(lines[j])) break;
    block.push(lines[j].trim());
  }
  let v = block.join(" ").trim().replace(/^[>|][+-]?\s*/, "").trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return Buffer.byteLength(v.trim());
}

function lintDir(dir) {
  const md = join(dir, "SKILL.md");
  if (!existsSync(md)) return { dir, errors: [`missing SKILL.md`], warnings: [] };
  const src = readFileSync(md, "utf8");
  const errors = [];
  const warnings = [];

  const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) errors.push("no YAML frontmatter");
  else {
    if (fm[1].length > 1024) errors.push("frontmatter >1024 chars");
    if (!/\bname:/.test(fm[1])) errors.push("frontmatter missing name");
    if (!/\bdescription:/.test(fm[1])) errors.push("frontmatter missing description");
    else {
      const db = descriptionBytes(fm[1]);
      if (db > DESCRIPTION_BUDGET) errors.push(`description ${db}B > ${DESCRIPTION_BUDGET}B budget`);
    }
  }

  const size = Buffer.byteLength(src);
  if (size > SKILL_SIZE_BUDGET) warnings.push(`SKILL.md ${size}B > ${SKILL_SIZE_BUDGET}B budget (split overflow into references/)`);

  const deep = src.match(DEEP_REF);
  if (deep) errors.push(`reference deeper than one level below the skill dir: ${[...new Set(deep)].join(", ")}`);

  const ns = src.match(BAD_NS);
  if (ns) errors.push(`non-superpowers namespace: ${[...new Set(ns)].join(", ")}`);

  // Duplication guard: canonical sentence + a legacy fetch/tool chain paragraph means
  // the sweep missed a spot — the skill both defers to routing.md AND restates a
  // per-skill ctx chain inline.
  if (CANONICAL_SENTENCE.test(src)) {
    const legacyLine = src.split("\n").find((line) => LEGACY_CHAIN.test(line));
    if (legacyLine) errors.push(`canonical sentence + legacy tool-selection chain: ${legacyLine.trim()}`);
  }

  src.split("\n").forEach((line, i) => {
    if (ALLOW_CONTEXT.some((r) => r.test(line))) return;
    for (const r of BLOCKED) {
      if (r.test(line)) errors.push(`blocked fetch pattern line ${i + 1}: ${r}`);
    }
  });

  return { dir, errors, warnings };
}

const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync("skills").filter((n) => n !== "shared").map((n) => join("skills", n)).filter((p) => statSync(p).isDirectory());

let failed = false;
for (const t of targets) {
  const { dir, errors, warnings = [] } = lintDir(t);
  const name = dir.replace(/^skills\//, "");
  for (const w of warnings) console.warn(`${name}: WARN - ${w}`);
  if (errors.length) { failed = true; console.error(`${name}: FAIL\n  - ${errors.join("\n  - ")}`); }
  else console.log(`${name}: frontmatter OK; cross-refs OK; no blocked fetch patterns`);
}

// Anchor sweep (Task 3): a `skills/shared/` citation with no `${CLAUDE_PLUGIN_ROOT}/`
// prefix gives the reader no way to resolve it against the plugin's installed
// location. Covers every .md under skills/, including references/ subdirs and
// skills/shared/ itself.
const UNANCHORED_SHARED = /(?<!\$\{CLAUDE_PLUGIN_ROOT\}\/)skills\/shared\//;
function walkMd(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkMd(p, out);
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}
for (const file of walkMd("skills")) {
  const src = readFileSync(file, "utf8");
  src.split(/\r?\n/).forEach((line, i) => {
    if (UNANCHORED_SHARED.test(line)) {
      failed = true;
      console.error(`${file}: FAIL\n  - unanchored skills/shared/ citation at line ${i + 1}: ${line.trim()}`);
    }
  });
}

// Conductor module byte budgets (Task 5).
const CONDUCTOR_DIR = join("skills", "shared", "conductor");
const ROUTING_BUDGET = 4000; // bytes, FAIL above
const ADAPTER_BUDGET = 6000; // bytes, FAIL above (excludes context-mode-adapter.md)
if (existsSync(CONDUCTOR_DIR)) {
  for (const name of readdirSync(CONDUCTOR_DIR).filter((n) => n.endsWith(".md"))) {
    const p = join(CONDUCTOR_DIR, name);
    const src = readFileSync(p, "utf8");
    const size = Buffer.byteLength(src);
    const budget = name === "routing.md" ? ROUTING_BUDGET : name === "context-mode-adapter.md" ? null : ADAPTER_BUDGET;

    // Strict dangling-link check: every relative markdown link inside a conductor
    // adapter must resolve (all six adapters + routing.md exist as of Task 12).
    const links = [...src.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
    for (const link of links) {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(link) || link.startsWith("#")) continue; // absolute URL / in-file anchor
      const filePart = link.split("#")[0];
      if (!filePart || !existsSync(join(CONDUCTOR_DIR, filePart))) {
        failed = true;
        console.error(`shared/conductor/${name}: FAIL\n  - dangling link: ${link}`);
      }
    }

    if (budget === null) continue;
    if (size > budget) { failed = true; console.error(`shared/conductor/${name}: FAIL\n  - ${size}B > ${budget}B budget`); }
    else console.log(`shared/conductor/${name}: ${size}B within ${budget}B budget`);
  }
}

process.exit(failed ? 1 : 0);
