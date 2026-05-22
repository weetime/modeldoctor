#!/usr/bin/env node
// Forbids Chinese characters (CJK Unified Ideographs U+4E00..U+9FFF) anywhere
// in apps/web/src, except for: locales/, tests/__tests__, *.test.tsx, the
// deployment-recipes/data.ts carve-out, and node_modules.
// This is a path-only guard — comments are NOT exempt. If you need a Chinese
// comment, translate it to English.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "..", "src");
const REL = (p) => relative(resolve(here, ".."), p).replaceAll("\\", "/");
const CJK = /[一-鿿]/;

const EXCLUDE_DIRS = new Set(["node_modules", "locales", "__tests__"]);
const EXCLUDE_FILES = new Set([
  // Carve-outs (file paths relative to apps/web/)
  "src/features/deployment-recipes/data.ts",
]);
const EXCLUDE_SUFFIXES = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (EXCLUDE_DIRS.has(name)) continue;
      yield* walk(p);
    } else if (st.isFile() && (p.endsWith(".ts") || p.endsWith(".tsx"))) {
      yield p;
    }
  }
}

let failed = false;
const hits = [];

for (const file of walk(SRC)) {
  const rel = REL(file);
  if (EXCLUDE_FILES.has(rel)) continue;
  if (EXCLUDE_SUFFIXES.some((s) => file.endsWith(s))) continue;

  const text = readFileSync(file, "utf8");
  if (!CJK.test(text)) continue;

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (CJK.test(lines[i])) {
      hits.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error("[no-hardcoded-zh] FAIL — CJK characters in source:");
  for (const h of hits.slice(0, 50)) console.error(`  ${h}`);
  if (hits.length > 50) console.error(`  …and ${hits.length - 50} more.`);
  console.error("\nFix: route user-facing strings through t(); translate comments to English.");
  process.exit(1);
}
console.log("[no-hardcoded-zh] OK — no CJK characters in source (excluding carve-outs).");
