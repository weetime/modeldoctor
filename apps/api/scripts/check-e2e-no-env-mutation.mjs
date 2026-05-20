#!/usr/bin/env node
// Forbids mutating `process.env` inside `beforeAll` / `beforeEach` hooks
// of apps/api e2e specs. All e2e env defaults must go through the
// E2E_ENV_DEFAULTS fixture (apps/api/test/setup/e2e-env-defaults.ts);
// per-spec mutation re-introduces the alerts-401 / mcp-503 class of bug
// that PRs #201 and #206 cleaned up. Closes #209.
//
// Heuristic, not a full TS parser: strip strings and comments to
// whitespace (preserving offsets), find each `beforeAll(`/`beforeEach(`
// call and its matching `)`, then regex inside that span. This catches
// the 99% case without pulling in TypeScript at lint time.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const API_ROOT = resolve(here, "..");
const DEFAULT_ROOT = resolve(API_ROOT, "test/e2e");

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "node_modules") continue;
    const p = `${dir}/${name}`;
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walk(p);
    } else if (st.isFile() && p.endsWith(".e2e-spec.ts")) {
      yield p;
    }
  }
}

// Replace string-literal and comment contents with spaces (newlines
// preserved) so subsequent regex scans only hit real code while line
// numbers stay aligned with the original source. Regex literals and
// `${...}` interpolation inside template strings are NOT tracked —
// neither appears in our hook bodies, and erring on "miss a hit" is
// safer than erring on "false positive in a string".
function stripStringsAndComments(src) {
  const out = new Array(src.length);
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") {
        out[i] = " ";
        i++;
      }
      continue;
    }
    if (c === "/" && c2 === "*") {
      out[i] = " ";
      out[i + 1] = " ";
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        out[i] = src[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n) {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
      }
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      out[i] = " ";
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\" && i + 1 < n) {
          out[i] = " ";
          out[i + 1] = src[i + 1] === "\n" ? "\n" : " ";
          i += 2;
          continue;
        }
        out[i] = src[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n) {
        out[i] = " ";
        i++;
      }
      continue;
    }
    out[i] = c;
    i++;
  }
  return out.join("");
}

function findHookSpans(stripped) {
  const spans = [];
  const re = /\bbefore(?:All|Each)\s*\(/g;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    let depth = 1;
    let i = re.lastIndex; // just after the opening `(`
    while (i < stripped.length && depth > 0) {
      const c = stripped[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      i++;
    }
    if (depth === 0) {
      spans.push([re.lastIndex, i - 1]); // [start, end) excluding the closing `)`
    }
  }
  return spans;
}

const PATTERNS = [
  /\bprocess\.env\.\w+\s*=(?!=)/g,
  /\bprocess\.env\[[^\]]+\]\s*=(?!=)/g,
  /\bdelete\s+process\.env\b/g,
];

function offsetToLine(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

export function findViolationsInSource(source) {
  const stripped = stripStringsAndComments(source);
  const spans = findHookSpans(stripped);
  const lines = source.split("\n");
  const hits = [];
  const seen = new Set();
  for (const [start, end] of spans) {
    for (const re of PATTERNS) {
      re.lastIndex = start;
      let m;
      while ((m = re.exec(stripped)) !== null) {
        if (m.index >= end) break;
        if (seen.has(m.index)) continue;
        seen.add(m.index);
        const line = offsetToLine(source, m.index);
        hits.push({ offset: m.index, line, text: lines[line - 1].trim() });
      }
    }
  }
  hits.sort((a, b) => a.offset - b.offset);
  return hits;
}

export function findViolations(rootDir) {
  const result = [];
  for (const file of walk(rootDir)) {
    const text = readFileSync(file, "utf8");
    const hits = findViolationsInSource(text);
    if (hits.length === 0) continue;
    result.push({ file, hits });
  }
  return result;
}

function main() {
  const cliRoot = process.argv[2];
  const root = cliRoot ? resolve(process.cwd(), cliRoot) : DEFAULT_ROOT;
  let st;
  try {
    st = statSync(root);
  } catch {
    console.error(`[no-e2e-env-mutation] FAIL — root not found: ${root}`);
    process.exit(2);
  }
  if (!st.isDirectory()) {
    console.error(`[no-e2e-env-mutation] FAIL — not a directory: ${root}`);
    process.exit(2);
  }
  const REL = (p) => relative(API_ROOT, p).replaceAll("\\", "/");
  const failures = findViolations(root);
  if (failures.length === 0) {
    console.log(
      `[no-e2e-env-mutation] OK — no process.env mutation inside beforeAll/beforeEach in ${REL(root)}.`,
    );
    process.exit(0);
  }
  console.error(
    "[no-e2e-env-mutation] FAIL — process.env must not be mutated inside beforeAll/beforeEach hooks of e2e specs.",
  );
  console.error(
    "  Route all defaults through E2E_ENV_DEFAULTS (apps/api/test/setup/e2e-env-defaults.ts). See PRs #201/#206 and issue #209.",
  );
  for (const { file, hits } of failures) {
    for (const h of hits) {
      console.error(`  ${REL(file)}:${h.line}: ${h.text}`);
    }
  }
  process.exit(1);
}

const isMain = process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) main();
