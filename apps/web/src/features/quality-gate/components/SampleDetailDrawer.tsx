import { Link } from "react-router-dom";
import type { EvaluationSample, RunSample } from "@modeldoctor/contracts";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export function SampleDetailDrawer({
  runId,
  row,
  snapshotSamples,
  onClose,
}: {
  runId: string;
  row: RunSample | null;
  snapshotSamples: EvaluationSample[];
  onClose: () => void;
}) {
  if (!row) return null;
  const snapshot = snapshotSamples.find((s) => s.id === row.sampleId);

  return (
    <Sheet open={!!row} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-[600px] sm:max-w-[600px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>样本 #{row.sampleIdx + 1}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 pt-4 text-sm">
          {snapshot && (
            <>
              <div>
                <div className="font-medium mb-1">题面</div>
                <pre className="whitespace-pre-wrap text-xs bg-muted p-2 rounded">
                  {snapshot.prompt}
                </pre>
              </div>
              <div>
                <div className="font-medium mb-1">期望</div>
                <pre className="whitespace-pre-wrap text-xs bg-muted p-2 rounded">
                  {snapshot.expected}
                </pre>
              </div>
            </>
          )}
          <div>
            <div className="font-medium mb-1">
              A 答案 {row.resultA.judge.passed ? "✓" : "✗"}
            </div>
            <pre className="whitespace-pre-wrap text-xs bg-muted p-2 rounded">
              {row.resultA.call.rawAnswer || "(空)"}
            </pre>
            {row.resultA.judge.reason && (
              <div className="text-muted-foreground mt-1">
                Judge: {row.resultA.judge.reason}
              </div>
            )}
            {row.resultA.call.error && (
              <div className="text-destructive mt-1">
                错误: {row.resultA.call.error}
              </div>
            )}
          </div>
          {row.resultB && (
            <div>
              <div className="font-medium mb-1">
                B 答案 {row.resultB.judge.passed ? "✓" : "✗"}
              </div>
              <pre className="whitespace-pre-wrap text-xs bg-muted p-2 rounded">
                {row.resultB.call.rawAnswer || "(空)"}
              </pre>
              {row.resultB.judge.reason && (
                <div className="text-muted-foreground mt-1">
                  Judge: {row.resultB.judge.reason}
                </div>
              )}
              {row.resultB.call.error && (
                <div className="text-destructive mt-1">
                  错误: {row.resultB.call.error}
                </div>
              )}
              <Link
                to={`/playground/chat?from=evaluation&runId=${runId}&sampleId=${row.id}&endpoint=B`}
              >
                <Button size="sm" variant="outline" className="mt-2">
                  在 Playground 复现 B
                </Button>
              </Link>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
