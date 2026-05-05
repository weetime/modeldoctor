import type { Benchmark } from "@modeldoctor/contracts";
import { UnknownReport } from "./UnknownReport";
import { VegetaGatewayMetrics } from "./vegeta/GatewayMetrics";

export interface GatewayReportProps {
  benchmark: Benchmark;
}

export function GatewayReport({ benchmark }: GatewayReportProps) {
  if (benchmark.tool !== "vegeta") {
    return <UnknownReport benchmark={benchmark} />;
  }
  return <VegetaGatewayMetrics benchmark={benchmark} />;
}
