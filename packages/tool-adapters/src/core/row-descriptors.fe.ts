import { aiperfRowDescriptors } from "../aiperf/row-descriptors.js";
import { evalscopeRowDescriptors } from "../evalscope/row-descriptors.js";
import { guidellmRowDescriptors } from "../guidellm/row-descriptors.js";
import { tau3RowDescriptors } from "../tau3/row-descriptors.js";
import { vegetaRowDescriptors } from "../vegeta/row-descriptors.js";
import { vllmOmniBenchRowDescriptors } from "../vllm-omni-bench/row-descriptors.js";
import type { ToolName } from "./interface.js";
import type { MetricRowSpec } from "./row-descriptor.js";

// `Record<ToolName, …>` is the compile-time exhaustiveness gate: adding a
// new tool to `ToolName` forces a matching entry here, so the FE compare
// grid can't silently fall through to an empty row set when a new
// inference tool ships.
export const rowDescriptorsByTool: Record<ToolName, readonly MetricRowSpec[]> = {
  guidellm: guidellmRowDescriptors,
  vegeta: vegetaRowDescriptors,
  evalscope: evalscopeRowDescriptors,
  aiperf: aiperfRowDescriptors,
  tau3: tau3RowDescriptors,
  "vllm-omni-bench": vllmOmniBenchRowDescriptors,
};
