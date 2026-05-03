import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useDeleteBaseline } from "@/features/baseline/queries";
import type { Run } from "@modeldoctor/contracts";
import {
  type GenaiPerfReport,
  type GuidellmReport,
  type VegetaReport,
  genaiPerfReportSchema,
  guidellmReportSchema,
  vegetaReportSchema,
} from "@modeldoctor/tool-adapters/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, SearchX } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { RunDetailMetadata } from "./RunDetailMetadata";
import { RunDetailRawOutput } from "./RunDetailRawOutput";
import { SetBaselineDialog } from "./SetBaselineDialog";
import { runKeys } from "./queries";
import { useRunDetail } from "./queries";
import { GenaiPerfReportView } from "./reports/GenaiPerfReportView";
import { GuidellmReportView } from "./reports/GuidellmReportView";
import { UnknownReportView } from "./reports/UnknownReportView";
import { VegetaReportView } from "./reports/VegetaReportView";

function ReportSection({ metrics }: { metrics: Run["summaryMetrics"] }) {
  const { t } = useTranslation("runs");
  if (!metrics) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {t("detail.metrics.empty")}
      </div>
    );
  }
  const tagged = metrics as { tool?: string; data?: unknown };
  switch (tagged.tool) {
    case "guidellm": {
      const parsed = guidellmReportSchema.safeParse(tagged.data);
      return parsed.success ? (
        <GuidellmReportView data={parsed.data as GuidellmReport} />
      ) : (
        <UnknownReportView raw={metrics} reason={parsed.error.message} />
      );
    }
    case "vegeta": {
      const parsed = vegetaReportSchema.safeParse(tagged.data);
      return parsed.success ? (
        <VegetaReportView data={parsed.data as VegetaReport} />
      ) : (
        <UnknownReportView raw={metrics} reason={parsed.error.message} />
      );
    }
    case "genai-perf": {
      const parsed = genaiPerfReportSchema.safeParse(tagged.data);
      return parsed.success ? (
        <GenaiPerfReportView data={parsed.data as GenaiPerfReport} />
      ) : (
        <UnknownReportView raw={metrics} reason={parsed.error.message} />
      );
    }
    default:
      return <UnknownReportView raw={metrics} reason="unknown report envelope" />;
  }
}

export function RunDetailPage() {
  const { t } = useTranslation("runs");
  const { id } = useParams<{ id: string }>();
  const { data: run, isLoading, isError, error } = useRunDetail(id ?? "");
  const qc = useQueryClient();

  const [setOpen, setSetOpen] = useState(false);
  const [unsetOpen, setUnsetOpen] = useState(false);
  const remove = useDeleteBaseline();

  if (isLoading) {
    return (
      <>
        <PageHeader title="…" />
        <div
          role="status"
          aria-label="loading"
          className="m-8 h-64 animate-pulse rounded-md border border-border bg-muted/30"
        />
      </>
    );
  }

  if (isError) {
    const status = (error as { status?: number } | null)?.status;
    if (status === 404) {
      return (
        <>
          <PageHeader title={id ?? "—"} />
          <EmptyState
            icon={SearchX}
            title={t("detail.notFound.title")}
            body={t("detail.notFound.body")}
          />
        </>
      );
    }
    return (
      <>
        <PageHeader title={id ?? "—"} />
        <Alert variant="destructive" className="mx-8 mt-6">
          <AlertDescription>{(error as Error)?.message ?? t("detail.loadError")}</AlertDescription>
        </Alert>
      </>
    );
  }

  if (!run) return null;

  const subtitle = t("detail.subtitle", {
    kind: run.kind,
    tool: run.tool,
    when: format(new Date(run.createdAt), "yyyy-MM-dd HH:mm"),
  });

  const isBaseline = run.baselineFor !== null;

  return (
    <>
      <PageHeader
        title={run.name ?? run.id}
        subtitle={subtitle}
        rightSlot={
          <div className="flex items-center gap-2">
            {isBaseline ? (
              <Button variant="secondary" size="sm" onClick={() => setUnsetOpen(true)}>
                {t("detail.baseline.unsetButton")}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setSetOpen(true)}>
                {t("detail.baseline.setButton")}
              </Button>
            )}
            <Button asChild variant="ghost" size="sm">
              <Link to="/runs">
                <ArrowLeft className="mr-1 h-4 w-4" />
                {t("detail.back")}
              </Link>
            </Button>
          </div>
        }
      />
      <div className="space-y-8 px-8 py-6">
        <section>
          <RunDetailMetadata run={run} />
        </section>
        {run.status === "failed" && run.statusMessage && (
          <Alert variant="destructive">
            <AlertTitle>{t("detail.statusMessage.title")}</AlertTitle>
            <AlertDescription>
              <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                {run.statusMessage}
              </pre>
            </AlertDescription>
          </Alert>
        )}
        <section>
          <h3 className="mb-3 text-sm font-semibold">{t("detail.metrics.title")}</h3>
          <ReportSection metrics={run.summaryMetrics} />
        </section>
        <section>
          <RunDetailRawOutput
            rawOutput={run.rawOutput as Record<string, unknown> | null}
            logs={run.logs}
          />
        </section>
      </div>

      <SetBaselineDialog
        runId={run.id}
        open={setOpen}
        onOpenChange={setSetOpen}
        onSuccess={() => qc.invalidateQueries({ queryKey: runKeys.detail(run.id) })}
      />

      <AlertDialog open={unsetOpen} onOpenChange={setUnsetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("detail.baseline.unsetConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("detail.baseline.unsetConfirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("detail.baseline.dialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (run.baselineFor) {
                  remove.mutate(run.baselineFor.id, {
                    onSuccess: () => {
                      setUnsetOpen(false);
                    },
                    onError: () => {
                      toast.error(t("detail.baseline.errors.generic"));
                    },
                  });
                }
              }}
              disabled={remove.isPending}
            >
              {t("detail.baseline.unsetConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
