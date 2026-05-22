#!/usr/bin/env node
// Move dist/cjs/*.js → dist/*.cjs (flat) and dist/cjs/*.d.ts → dist/*.d.cts.
// Phase 2 (#224) removes this script along with the cjs build output.
import { readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const cjsDir = join(__dirname, "..", "dist", "cjs");
const outDir = join(__dirname, "..", "dist");

const files = await readdir(cjsDir);
for (const f of files) {
  if (f.endsWith(".js")) {
    const base = f.replace(/\.js$/, "");
    await rename(join(cjsDir, f), join(outDir, `${base}.cjs`));
  } else if (f.endsWith(".js.map")) {
    const base = f.replace(/\.js\.map$/, "");
    await rename(join(cjsDir, f), join(outDir, `${base}.cjs.map`));
  } else if (f.endsWith(".d.ts.map")) {
    const base = f.replace(/\.d\.ts\.map$/, "");
    await rename(join(cjsDir, f), join(outDir, `${base}.d.cts.map`));
  } else if (f.endsWith(".d.ts")) {
    const base = f.replace(/\.d\.ts$/, "");
    await rename(join(cjsDir, f), join(outDir, `${base}.d.cts`));
  }
}
await rm(cjsDir, { recursive: true });
console.log(`renamed CJS outputs from ${cjsDir} into ${outDir} as .cjs/.d.cts`);
