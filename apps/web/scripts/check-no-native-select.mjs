#!/usr/bin/env node
// Forbids native <select> and <textarea> in TSX, except the shadcn UI
// wrappers in components/ui/ which legitimately wrap them.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "..", "src");
const REL = (p) => relative(resolve(here, ".."), p).replaceAll("\\", "/");
const PAT = /<(select|textarea)\b/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules") continue;
      yield* walk(p);
    } else if (st.isFile() && p.endsWith(".tsx")) {
      yield p;
    }
  }
}

let failed = false;
const hits = [];

for (const file of walk(SRC)) {
  const rel = REL(file);
  if (rel.startsWith("src/components/ui/")) continue; // shadcn wrappers OK

  const text = readFileSync(file, "utf8");
  if (!PAT.test(text)) continue;

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (PAT.test(lines[i])) {
      hits.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error("[no-native-select] FAIL — use shadcn <Select> / <Textarea> instead:");
  for (const h of hits) console.error("  " + h);
  process.exit(1);
}
console.log("[no-native-select] OK — no native <select>/<textarea> outside components/ui/.");
