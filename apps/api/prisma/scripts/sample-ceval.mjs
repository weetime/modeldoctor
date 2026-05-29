#!/usr/bin/env node
// One-shot generator: samples C-Eval (ceval/ceval-exam) across a balanced set of
// subjects and emits a built-in evaluation block for seed.ts. C-Eval is
// CC-BY-NC-SA-4.0 (non-commercial) — bundled for self/non-commercial use only;
// split out before any commercial distribution.
//
// Source: HuggingFace datasets-server /rows API (no python / HF auth needed).
// We pull from the `val` split because C-Eval's `test` answers are withheld.
//
// Usage: node apps/api/prisma/scripts/sample-ceval.mjs > /tmp/ceval-seed.json

const DATASET = "ceval/ceval-exam";
const SPLIT = "val";
const PER_SUBJECT = 5;

// Balanced spread across STEM / humanities / social-science / professional.
// cn = Chinese subject name for the prompt stem.
const SUBJECTS = [
  { config: "advanced_mathematics", cn: "高等数学" },
  { config: "computer_network", cn: "计算机网络" },
  { config: "college_physics", cn: "大学物理" },
  { config: "high_school_chemistry", cn: "高中化学" },
  { config: "probability_and_statistics", cn: "概率统计" },
  { config: "chinese_language_and_literature", cn: "中国语言文学" },
  { config: "high_school_history", cn: "高中历史" },
  { config: "college_economics", cn: "大学经济学" },
  { config: "law", cn: "法学" },
  { config: "marxism", cn: "马克思主义基本原理" },
  { config: "logic", cn: "逻辑学" },
  { config: "modern_chinese_history", cn: "近代史纲要" },
];

const LABELS = ["A", "B", "C", "D"];

async function fetchRows(config) {
  const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(
    DATASET,
  )}&config=${encodeURIComponent(config)}&split=${SPLIT}&offset=0&length=${PER_SUBJECT}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${config}: HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.rows))
    throw new Error(`${config}: ${JSON.stringify(data).slice(0, 120)}`);
  return data.rows.map((r) => r.row);
}

function buildPrompt(cn, row) {
  return [
    `以下是一道关于「${cn}」的单项选择题，请只回答正确选项的字母（A/B/C/D），不要解释。`,
    "",
    row.question,
    `A. ${row.A}`,
    `B. ${row.B}`,
    `C. ${row.C}`,
    `D. ${row.D}`,
  ].join("\n");
}

async function main() {
  const samples = [];
  let idx = 0;
  for (const { config, cn } of SUBJECTS) {
    const rows = await fetchRows(config);
    for (const row of rows) {
      const answer = String(row.answer || "")
        .trim()
        .toUpperCase();
      if (!LABELS.includes(answer)) continue; // skip malformed
      samples.push({
        id: `smp_ceval_${config}_${row.id}`,
        idx: idx++,
        prompt: buildPrompt(cn, row),
        expected: answer,
        judgeConfig: { kind: "multiple-choice", answer },
        tags: ["ceval", config],
      });
    }
  }
  process.stdout.write(JSON.stringify(samples, null, 2) + "\n");
  process.stderr.write(`generated ${samples.length} samples across ${SUBJECTS.length} subjects\n`);
}

main().catch((e) => {
  process.stderr.write(`FAILED: ${e.message}\n`);
  process.exit(1);
});
