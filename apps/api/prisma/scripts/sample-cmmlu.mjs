#!/usr/bin/env node
// One-shot generator: samples CMMLU (Chinese MCQ) emphasising China-specific
// subjects that C-Eval doesn't cover (古代汉语 / 中医 / 中国驾驶规则 …), so the
// built-in complements C-Eval rather than duplicating it. CMMLU is
// CC-BY-NC-4.0 (non-commercial) — bundled for self/non-commercial use only;
// split out before any commercial distribution.
//
// Source: the lmlmcat/cmmlu mirror ships data as a zip (a custom loader script
// means the HF datasets-server viewer is unavailable; the canonical
// haonan-li/cmmlu repo was renamed). We download the zip and read the `test`
// split CSVs (which include the Answer column).
//
// Usage: node apps/api/prisma/scripts/sample-cmmlu.mjs > /tmp/cmmlu-seed.json

import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ZIP_URL = "https://huggingface.co/datasets/lmlmcat/cmmlu/resolve/main/cmmlu_v1_0_1.zip";
const PER_SUBJECT = 5;
const LABELS = ["A", "B", "C", "D"];

// China-centric subjects (config → Chinese name) — the dimension C-Eval lacks.
const SUBJECTS = [
  { id: "ancient_chinese", cn: "古代汉语" },
  { id: "chinese_history", cn: "中国历史" },
  { id: "chinese_literature", cn: "中国文学" },
  { id: "traditional_chinese_medicine", cn: "中医" },
  { id: "chinese_food_culture", cn: "中国饮食文化" },
  { id: "chinese_driving_rule", cn: "中国驾驶规则" },
  { id: "ethnology", cn: "民族学" },
  { id: "chinese_foreign_policy", cn: "中国外交政策" },
  { id: "modern_chinese", cn: "现代汉语" },
  { id: "chinese_civil_service_exam", cn: "中国公务员考试" },
  { id: "elementary_chinese", cn: "小学语文" },
  { id: "chinese_teacher_qualification", cn: "中国教师资格" },
];

// Minimal RFC-4180 CSV parser: handles quoted fields with embedded commas,
// "" escapes, and newlines.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

function buildPrompt(cn, q) {
  return [
    `以下是一道关于「${cn}」的单项选择题，请只回答正确选项的字母（A/B/C/D），不要解释。`,
    "",
    q.Question,
    `A. ${q.A}`,
    `B. ${q.B}`,
    `C. ${q.C}`,
    `D. ${q.D}`,
  ].join("\n");
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "cmmlu-"));
  const zipPath = join(dir, "cmmlu.zip");
  process.stderr.write("downloading CMMLU zip…\n");
  const res = await fetch(ZIP_URL);
  if (!res.ok) throw new Error(`zip download HTTP ${res.status}`);
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  const members = SUBJECTS.map((s) => `test/${s.id}.csv`).join(" ");
  execSync(`unzip -o ${zipPath} ${members} -d ${dir}`, { stdio: "ignore" });

  const samples = [];
  let idx = 0;
  for (const { id, cn } of SUBJECTS) {
    const rows = parseCsv(readFileSync(join(dir, "test", `${id}.csv`), "utf-8"));
    const header = rows[0];
    const col = (name) => header.indexOf(name);
    const [qi, ai, bi, ci, di, ansi] = [
      col("Question"),
      col("A"),
      col("B"),
      col("C"),
      col("D"),
      col("Answer"),
    ];
    for (const r of rows.slice(1, 1 + PER_SUBJECT)) {
      const answer = (r[ansi] || "").trim().toUpperCase();
      if (!LABELS.includes(answer)) continue;
      const q = { Question: r[qi], A: r[ai], B: r[bi], C: r[ci], D: r[di] };
      samples.push({
        id: `smp_cmmlu_${id}_${r[0]}`,
        idx: idx++,
        prompt: buildPrompt(cn, q),
        expected: answer,
        judgeConfig: { kind: "multiple-choice", answer },
        tags: ["cmmlu", id],
      });
    }
  }
  process.stdout.write(`${JSON.stringify(samples, null, 2)}\n`);
  process.stderr.write(`generated ${samples.length} samples across ${SUBJECTS.length} subjects\n`);
}

main().catch((e) => {
  process.stderr.write(`FAILED: ${e.message}\n`);
  process.exit(1);
});
