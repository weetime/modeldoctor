#!/usr/bin/env node
// Guard against ".env.example drift" — every env var declared in
// src/config/env.schema.ts MUST appear in apps/api/.env.example so a
// fresh `cp .env.example .env` boots the api without a startup zod
// failure. Lives in the same CI lane as the existing web lint
// scripts (check-no-native-select / check-no-confirm).
//
// Heuristic, not full TS parser: scan the schema source for lines
// of the form
//   ^<indent>KEY_NAME: z.<rest>
// at the top-level object indent, dedup, and compare to the keys
// in .env.example (which match `^[# ]*KEY=`). Commented-out vars in
// .env.example (e.g. `# KUBECONFIG=...`) count as documented — the
// example file is the README for the env, not a working .env.

import { readFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const API_ROOT = resolve(here, "..");
const SCHEMA_PATH = resolve(API_ROOT, "src/config/env.schema.ts");
const EXAMPLE_PATH = resolve(API_ROOT, ".env.example");
const REL = (p) => relative(API_ROOT, p).replaceAll("\\", "/");

const schemaSrc = readFileSync(SCHEMA_PATH, "utf8");
const exampleSrc = readFileSync(EXAMPLE_PATH, "utf8");

// Schema keys: top-level zod fields. Looks for `<indent>NAME: <ident>`
// where NAME is SCREAMING_SNAKE_CASE and <ident> is a lowercase token
// (the start of `z.string()...`, `envBoolean.default(...)`, etc.).
// Requiring a lowercase RHS skips false positives like
// `path: ["DATABASE_URL"]` inside superRefine (path is lowercase but
// the RHS is `[`). Multi-line zod chains (e.g. `KEY: z\n  .string()`)
// match because we don't anchor to `z.` — any lowercase identifier
// after the colon counts.
const schemaKeyPat = /^\s+([A-Z][A-Z0-9_]*):\s*[a-z]/gm;
const schemaKeys = new Set();
for (const m of schemaSrc.matchAll(schemaKeyPat)) {
  schemaKeys.add(m[1]);
}

// Example keys: lines like `KEY=...` or `# KEY=...` (commented-out
// docs). Strip leading `#` + whitespace before matching.
const exampleKeyPat = /^[#\s]*([A-Z][A-Z0-9_]*)=/gm;
const exampleKeys = new Set();
for (const m of exampleSrc.matchAll(exampleKeyPat)) {
  exampleKeys.add(m[1]);
}

const missing = [...schemaKeys].filter((k) => !exampleKeys.has(k)).sort();
const extra = [...exampleKeys].filter((k) => !schemaKeys.has(k)).sort();

if (missing.length === 0 && extra.length === 0) {
  console.log(
    `[env-example] OK — ${schemaKeys.size} env vars match between ${REL(SCHEMA_PATH)} and ${REL(EXAMPLE_PATH)}.`,
  );
  process.exit(0);
}

console.error("[env-example] FAIL — drift between env.schema.ts and .env.example:");
if (missing.length > 0) {
  console.error(`\n  ${missing.length} key(s) declared in env.schema.ts but missing from .env.example:`);
  for (const k of missing) console.error(`    - ${k}`);
  console.error(`\n  Fix: add each missing key to apps/api/.env.example with a placeholder or default value.`);
}
if (extra.length > 0) {
  console.error(`\n  ${extra.length} key(s) in .env.example with no matching entry in env.schema.ts:`);
  for (const k of extra) console.error(`    - ${k}`);
  console.error(`\n  Fix: remove the orphan key from .env.example, or wire it into env.schema.ts.`);
}
process.exit(1);
