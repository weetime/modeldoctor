import type { Benchmark } from "@modeldoctor/contracts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export interface UnknownReportProps {
  benchmark: Benchmark;
  /** Optional context — parse error message from a scenario-specific metrics component. */
  reason?: string;
}

export function UnknownReport({ benchmark, reason }: UnknownReportProps) {
  return (
    <Alert className="border-amber-300 bg-amber-50/50 dark:bg-amber-950/20">
      <AlertTitle>Report shape not recognized</AlertTitle>
      <AlertDescription className="space-y-2">
        <div className="text-xs text-muted-foreground">
          No report renderer for scenario={benchmark.scenario} / tool={benchmark.tool}.
        </div>
        {reason && <div className="text-xs text-muted-foreground">{reason}</div>}
        <pre className="overflow-x-auto rounded bg-muted/50 p-2 text-xs">
          {JSON.stringify(benchmark.summaryMetrics, null, 2)}
        </pre>
      </AlertDescription>
    </Alert>
  );
}
