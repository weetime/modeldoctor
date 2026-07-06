import type { ToolAdapter, ToolReport } from "../core/interface.js";
import { buildTau2Command, tau2MaxDurationSeconds, tau2ParseProgress } from "./build-command.js";
import { tau2ReadMetric } from "./read-metric.js";
import { tau2ParamDefaults, tau2ParamsSchema, tau2ReportSchema } from "./schema.js";

export { tau2ReadMetric } from "./read-metric.js";

export const tau2Adapter: ToolAdapter = {
  name: "tau2",
  scenarios: ["agent"],
  paramsSchema: tau2ParamsSchema,
  reportSchema: tau2ReportSchema,
  paramDefaults: tau2ParamDefaults,
  buildCommand: buildTau2Command,
  parseProgress: tau2ParseProgress,
  getMaxDurationSeconds: tau2MaxDurationSeconds,
  readMetric: tau2ReadMetric,
  parseFinalReport(_stdout: string, files: Record<string, Buffer>): ToolReport {
    const buf = files.summary;
    if (!buf) throw new Error("tau2 parseFinalReport: missing 'summary' output file (summary.json)");
    const data = tau2ReportSchema.parse(JSON.parse(buf.toString("utf8")));
    return { tool: "tau2", data };
  },
};
