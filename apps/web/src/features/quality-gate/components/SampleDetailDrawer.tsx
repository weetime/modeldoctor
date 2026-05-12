import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { EvaluationSample, RunSample } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

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
  const { t } = useTranslation("quality-gate");
  if (!row) return null;
  const snapshot = snapshotSamples.find((s) => s.id === row.sampleId);

  return (
    <Sheet open={!!row} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-[600px] sm:max-w-[600px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {t("report.sampleDrawer.title")} #{row.sampleIdx + 1}
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 pt-4 text-sm">
          {snapshot && (
            <>
              <div>
                <div className="font-medium mb-1">{t("samples.promptLabel")}</div>
                <pre className="whitespace-pre-wrap text-xs bg-muted p-2 rounded">
                  {snapshot.prompt}
                </pre>
              </div>
              <div>
                <div className="font-medium mb-1">{t("runs.report.expected")}</div>
                <pre className="whitespace-pre-wrap text-xs bg-muted p-2 rounded">
                  {snapshot.expected}
                </pre>
              </div>
            </>
          )}
          <div>
            <div className="font-medium mb-1">
              {t("runs.report.answerA")} {row.resultA.judge.passed ? "✓" : "✗"}
            </div>
            <pre className="whitespace-pre-wrap text-xs bg-muted p-2 rounded">
              {row.resultA.call.rawAnswer || t("runs.report.emptyAnswer")}
            </pre>
            {row.resultA.judge.reason && (
              <div className="text-muted-foreground mt-1">
                {t("runs.report.judgePrefix")}: {row.resultA.judge.reason}
              </div>
            )}
            {row.resultA.call.error && (
              <div className="text-destructive mt-1">
                {t("runs.report.errorPrefix")}: {row.resultA.call.error}
              </div>
            )}
          </div>
          {row.resultB && (
            <div>
              <div className="font-medium mb-1">
                {t("runs.report.answerB")} {row.resultB.judge.passed ? "✓" : "✗"}
              </div>
              <pre className="whitespace-pre-wrap text-xs bg-muted p-2 rounded">
                {row.resultB.call.rawAnswer || t("runs.report.emptyAnswer")}
              </pre>
              {row.resultB.judge.reason && (
                <div className="text-muted-foreground mt-1">
                  {t("runs.report.judgePrefix")}: {row.resultB.judge.reason}
                </div>
              )}
              {row.resultB.call.error && (
                <div className="text-destructive mt-1">
                  {t("runs.report.errorPrefix")}: {row.resultB.call.error}
                </div>
              )}
              <Link
                to={`/playground/chat?from=evaluation&runId=${runId}&sampleId=${row.id}&endpoint=B`}
              >
                <Button size="sm" variant="outline" className="mt-2">
                  {t("runs.report.playgroundReproduceB")}
                </Button>
              </Link>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
