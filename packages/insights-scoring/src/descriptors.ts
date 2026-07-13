import type { BenchmarkTool, RadarAxisId, ScenarioId } from "@modeldoctor/contracts";
import type { MetricKind } from "@modeldoctor/tool-adapters";
import { capacityChecks } from "./checks/capacity.js";
import { gatewayChecks } from "./checks/gateway.js";
import { inferenceChecks } from "./checks/inference.js";
import type { Direction } from "./evaluate.js";

export interface CheckDescriptor {
  id: string;
  scenario: ScenarioId;
  toolFilter?: BenchmarkTool[];
  axis: RadarAxisId;
  defaultWeight: number;
  direction: Direction;
  metricKind: MetricKind;
}

export const ALL_CHECKS: CheckDescriptor[] = [
  ...inferenceChecks,
  ...capacityChecks,
  ...gatewayChecks,
];

const byId = new Map(ALL_CHECKS.map((c) => [c.id, c]));

export function getCheck(id: string): CheckDescriptor | undefined {
  return byId.get(id);
}
