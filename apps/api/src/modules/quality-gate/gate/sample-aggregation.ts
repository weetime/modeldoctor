import type { AggregateMetrics, JudgeOutcome, SampleDelta } from "@modeldoctor/contracts";

export function computeDelta(judgedA: JudgeOutcome, judgedB: JudgeOutcome | null): SampleDelta {
  if (judgedB == null) return "NA";
  if (judgedA.passed && judgedB.passed) return "BOTH_PASS";
  if (!judgedA.passed && !judgedB.passed) return "BOTH_FAIL";
  if (judgedA.passed && !judgedB.passed) return "REGRESSION";
  return "IMPROVEMENT";
}

export interface SampleRow {
  resultA: { call: { error?: string }; judge: JudgeOutcome };
  resultB: { call: { error?: string }; judge: JudgeOutcome } | null;
}

export function aggregateMetrics(rows: SampleRow[], judgeCallCount: number): AggregateMetrics {
  const total = rows.length;
  if (total === 0) {
    return {
      passRateA: 0,
      bothPassCount: 0,
      bothFailCount: 0,
      totalErrors: 0,
      judgeCallCount,
    };
  }
  const dual = rows.some((r) => r.resultB != null);

  let passA = 0;
  let passB = 0;
  let errors = 0;
  let bothPass = 0;
  let bothFail = 0;
  let reg = 0;
  let imp = 0;
  let scoreSumA = 0;
  let scoreNA = 0;
  let scoreSumB = 0;
  let scoreNB = 0;
  for (const r of rows) {
    if (r.resultA.call.error) errors++;
    if (r.resultA.judge.passed) passA++;
    if (typeof r.resultA.judge.score === "number") {
      scoreSumA += r.resultA.judge.score;
      scoreNA++;
    }
    if (r.resultB) {
      if (r.resultB.call.error) errors++;
      if (r.resultB.judge.passed) passB++;
      if (typeof r.resultB.judge.score === "number") {
        scoreSumB += r.resultB.judge.score;
        scoreNB++;
      }
      if (r.resultA.judge.passed && r.resultB.judge.passed) bothPass++;
      else if (!r.resultA.judge.passed && !r.resultB.judge.passed) bothFail++;
      else if (r.resultA.judge.passed) reg++;
      else imp++;
    }
  }
  return {
    passRateA: passA / total,
    passRateB: dual ? passB / total : undefined,
    judgeAvgA: scoreNA > 0 ? scoreSumA / scoreNA : undefined,
    judgeAvgB: dual && scoreNB > 0 ? scoreSumB / scoreNB : undefined,
    regressionCount: dual ? reg : undefined,
    improvementCount: dual ? imp : undefined,
    bothPassCount: bothPass,
    bothFailCount: bothFail,
    totalErrors: errors,
    judgeCallCount,
  };
}
