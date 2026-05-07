import type { BenchmarkTool, RadarAxisId, ScenarioId } from "@modeldoctor/contracts";
import type { Direction } from "../evaluate";
import { capacityChecks } from "./capacity";
import { gatewayChecks } from "./gateway";
import { inferenceChecks } from "./inference";

type SummaryMetrics = unknown;

export interface CheckDescriptor {
  id: string;
  scenario: ScenarioId;
  toolFilter?: BenchmarkTool[];
  axis: RadarAxisId;
  defaultWeight: number;
  read: (m: SummaryMetrics) => number | null;
  direction: Direction;
  recommendationKey: string;
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
