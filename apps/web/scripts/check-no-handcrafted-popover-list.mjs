#!/usr/bin/env node
// Warn-only: detects co-occurrence of <Popover, <Input, and <ul in features/.
// Signals a likely hand-rolled searchable dropdown that should use <Combobox>.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FEATURES = resolve(here, "..", "src", "features");
const REL = (p) => relative(resolve(here, ".."), p).replaceAll("\\", "/");

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      yield* walk(p);
    } else if (st.isFile() && p.endsWith(".tsx")) {
      yield p;
    }
  }
}

const hits = [];
for (const file of walk(FEATURES)) {
  const text = readFileSync(file, "utf8");
  if (text.includes("<Popover") && text.includes("<Input") && text.includes("<ul")) {
    hits.push(REL(file));
  }
}

if (hits.length) {
  console.warn("[no-handcrafted-popover-list] suspected hand-rolled searchable dropdowns:");
  for (const h of hits) console.warn("  " + h);
  console.warn("Consider replacing with <Combobox> from components/ui/combobox.tsx.");
}
// Always exit 0 — warning only.
