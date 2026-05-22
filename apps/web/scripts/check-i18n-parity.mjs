#!/usr/bin/env node
// Compares zh-CN and en-US namespace JSONs for key-set equality. Recursive.
// Exits 1 on any difference, printing the missing dot-paths per side.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const localesRoot = resolve(here, "..", "src", "locales");
const ZH = join(localesRoot, "zh-CN");
const EN = join(localesRoot, "en-US");

function flatten(obj, prefix = "", out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      flatten(v, path, out);
    } else {
      out.add(path);
    }
  }
  return out;
}

const zhFiles = new Set(readdirSync(ZH).filter((f) => f.endsWith(".json")));
const enFiles = new Set(readdirSync(EN).filter((f) => f.endsWith(".json")));

let failed = false;

const onlyInZh = [...zhFiles].filter((f) => !enFiles.has(f));
const onlyInEn = [...enFiles].filter((f) => !zhFiles.has(f));
if (onlyInZh.length || onlyInEn.length) {
  console.error("[i18n-parity] namespace files diverge");
  if (onlyInZh.length) console.error("  zh-CN only:", onlyInZh.join(", "));
  if (onlyInEn.length) console.error("  en-US only:", onlyInEn.join(", "));
  failed = true;
}

for (const ns of zhFiles) {
  if (!enFiles.has(ns)) continue;
  const zh = flatten(JSON.parse(readFileSync(join(ZH, ns), "utf8")));
  const en = flatten(JSON.parse(readFileSync(join(EN, ns), "utf8")));
  const missingInEn = [...zh].filter((k) => !en.has(k));
  const missingInZh = [...en].filter((k) => !zh.has(k));
  if (missingInEn.length || missingInZh.length) {
    failed = true;
    console.error(`[i18n-parity] ${ns}`);
    for (const k of missingInEn) console.error(`  missing in en-US: ${k}`);
    for (const k of missingInZh) console.error(`  missing in zh-CN: ${k}`);
  }
}

if (failed) {
  console.error("\n[i18n-parity] FAIL — add the missing keys to both locales.");
  process.exit(1);
}
console.log("[i18n-parity] OK — zh-CN and en-US key sets match.");
