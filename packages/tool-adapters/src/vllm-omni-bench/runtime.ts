import type {
  BuildCommandPlan,
  BuildCommandResult,
  ProgressEvent,
  ToolReport,
} from "../core/interface.js";
import { type VllmOmniBenchParams, vllmOmniBenchReportSchema } from "./schema.js";

const OUTPUTS_DIR = "out";
const RESULT_FILE = "omni_result.json";

// argv 是 runner 内驱动脚本,不是 bench 本体 —— bench 的循环调用、stdout
// 解析、聚合都在 runner.tools.omni_driver(Python)里,契约见其 docstring。
export function buildCommand(plan: BuildCommandPlan<VllmOmniBenchParams>): BuildCommandResult {
  const { params, connection } = plan;
  // vllm bench 的 openai 后端只从 OPENAI_API_KEY env 取 Bearer,没有自定义
  // header / query 通道;静默丢弃会导致对着鉴权网关 100% 401,故 fail fast。
  if (connection.customHeaders?.trim()) {
    throw new Error("vllm-omni-bench does not support connection customHeaders (v1)");
  }
  if (connection.queryParams?.trim()) {
    throw new Error("vllm-omni-bench does not support connection queryParams (v1)");
  }
  const env: Record<string, string> = {
    MD_OMNI_PARAMS: JSON.stringify(params),
    MD_OMNI_BASE_URL: connection.baseUrl.replace(/\/+$/, ""),
    MD_OMNI_MODEL: connection.model,
  };
  if (connection.tokenizerHfId) env.MD_OMNI_TOKENIZER_HF_ID = connection.tokenizerHfId;
  return {
    argv: ["python", "-m", "runner.tools.omni_driver"],
    env,
    secretEnv: { OPENAI_API_KEY: connection.apiKey },
    outputFiles: { report: `${OUTPUTS_DIR}/${RESULT_FILE}` },
  };
}

// driver 每完成一个点打一行:`[omni-driver] point arm=audio c=8 done (3/8)`。
const PROGRESS_RE = /^\[omni-driver\] (point .* \((\d+)\/(\d+)\))$/;

export function parseProgress(line: string): ProgressEvent | null {
  const m = PROGRESS_RE.exec(line.trim());
  if (!m) return null;
  const done = Number(m[2]);
  const total = Number(m[3]);
  if (!Number.isFinite(done) || !Number.isFinite(total) || total === 0) return null;
  return { kind: "progress", pct: (done / total) * 100, message: m[1] };
}

export function parseFinalReport(_stdout: string, files: Record<string, Buffer>): ToolReport {
  const buf = files.report;
  if (!buf) throw new Error("vllm-omni-bench.parseFinalReport: missing 'report' output file");
  const data = vllmOmniBenchReportSchema.parse(JSON.parse(buf.toString("utf8")));
  return { tool: "vllm-omni-bench", data };
}

export function getMaxDurationSeconds(params: VllmOmniBenchParams): number {
  const arms = params.voiceTax ? 2 : 1;
  const points = params.concurrencyLevels.length * arms;
  // 每点上界 = perPointTimeoutSeconds(driver 层强制);+300s 启动/上传缓冲。
  return Math.max(300, Math.min(14400, points * params.perPointTimeoutSeconds + 300));
}
