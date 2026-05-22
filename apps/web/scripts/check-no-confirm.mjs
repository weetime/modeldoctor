#!/usr/bin/env node
// Forbids window.confirm / window.alert — use AlertDialog instead.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "..", "src");
const REL = (p) => relative(resolve(here, ".."), p).replaceAll("\\", "/");
const PAT = /\bwindow\.(confirm|alert)\(/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules") continue;
      yield* walk(p);
    } else if (st.isFile() && (p.endsWith(".ts") || p.endsWith(".tsx"))) {
      yield p;
    }
  }
}

let failed = false;
const hits = [];

for (const file of walk(SRC)) {
  const text = readFileSync(file, "utf8");
  if (!PAT.test(text)) continue;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (PAT.test(lines[i])) {
      hits.push(`${REL(file)}:${i + 1}: ${lines[i].trim()}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error("[no-confirm] FAIL — use AlertDialog instead of window.confirm/alert:");
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log("[no-confirm] OK — no window.confirm/alert in source.");
