import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { EvaluationSample, RunSample } from "@modeldoctor/contracts";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

function PassIcon({ passed }: { passed: boolean }) {
  return passed ? (
    <Check className="h-4 w-4 text-emerald-500" aria-label="pass" />
  ) : (
    <X className="h-4 w-4 text-destructive" aria-label="fail" />
  );
}

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
                <pre className="whitespace-pre-wrap text-xs bg-muted p-2 rounded-md">
                  {snapshot.prompt}
                </pre>
              </div>
              <div>
                <div className="font-medium mb-1">{t("runs.report.expected")}</div>
                <pre className="whitespace-pre-wrap text-xs bg-muted p-2 rounded-md">
                  {snapshot.expected}
                </pre>
              </div>
            </>
          )}
          <div>
            <div className="font-medium mb-1 flex items-center gap-2">
              <span>{t("runs.report.answerA")}</span>
              <PassIcon passed={row.resultA.judge.passed} />
            </div>
            <pre className="whitespace-pre-wrap text-xs bg-muted p-2 rounded-md">
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
            <Link
              to={`/playground/chat?from=evaluation&runId=${runId}&sampleId=${row.id}&endpoint=A`}
            >
              <Button size="sm" variant="outline" className="mt-2">
                {t("runs.report.playgroundReproduceA")}
              </Button>
            </Link>
          </div>
          {row.resultB && (
            <div>
              <div className="font-medium mb-1 flex items-center gap-2">
                <span>{t("runs.report.answerB")}</span>
                <PassIcon passed={row.resultB.judge.passed} />
              </div>
              <pre className="whitespace-pre-wrap text-xs bg-muted p-2 rounded-md">
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
