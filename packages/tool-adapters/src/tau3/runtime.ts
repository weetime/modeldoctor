import type { ToolAdapter, ToolReport } from "../core/interface.js";
import { buildTau3Command, tau3MaxDurationSeconds, tau3ParseProgress } from "./build-command.js";
import { tau3ReadMetric } from "./read-metric.js";
import { tau3ParamDefaults, tau3ParamsSchema, tau3ReportSchema } from "./schema.js";

export { tau3ReadMetric } from "./read-metric.js";

export const tau3Adapter: ToolAdapter = {
  name: "tau3",
  scenarios: ["agent"],
  paramsSchema: tau3ParamsSchema,
  reportSchema: tau3ReportSchema,
  paramDefaults: tau3ParamDefaults,
  buildCommand: buildTau3Command,
  parseProgress: tau3ParseProgress,
  getMaxDurationSeconds: tau3MaxDurationSeconds,
  readMetric: tau3ReadMetric,
  parseFinalReport(_stdout: string, files: Record<string, Buffer>): ToolReport {
    const buf = files.summary;
    if (!buf) throw new Error("tau3 parseFinalReport: missing 'summary' output file (summary.json)");
    const data = tau3ReportSchema.parse(JSON.parse(buf.toString("utf8")));
    return { tool: "tau3", data };
  },
};
