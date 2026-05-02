import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, SearchX } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { HistoryDetailMetadata } from "./HistoryDetailMetadata";
import { HistoryDetailMetrics } from "./HistoryDetailMetrics";
import { HistoryDetailRawOutput } from "./HistoryDetailRawOutput";
import { SetBaselineDialog } from "./SetBaselineDialog";
import { historyKeys } from "./queries";
import { useRunDetail } from "./queries";

export function HistoryDetailPage() {
  const { t } = useTranslation("history");
  const { runId } = useParams<{ runId: string }>();
  const { data: run, isLoading, isError, error } = useRunDetail(runId ?? "");
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
          <PageHeader title={runId ?? "—"} />
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
        <PageHeader title={runId ?? "—"} />
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
              <Link to="/history">
                <ArrowLeft className="mr-1 h-4 w-4" />
                {t("detail.back")}
              </Link>
            </Button>
          </div>
        }
      />
      <div className="space-y-8 px-8 py-6">
        <section>
          <HistoryDetailMetadata run={run} />
        </section>
        <section>
          <h3 className="mb-3 text-sm font-semibold">{t("detail.metrics.title")}</h3>
          <HistoryDetailMetrics metrics={run.summaryMetrics} />
        </section>
        <section>
          <HistoryDetailRawOutput
            rawOutput={run.rawOutput as Record<string, unknown> | null}
            logs={run.logs}
          />
        </section>
      </div>

      <SetBaselineDialog
        runId={run.id}
        open={setOpen}
        onOpenChange={setSetOpen}
        onSuccess={() => qc.invalidateQueries({ queryKey: historyKeys.detail(run.id) })}
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
                      qc.invalidateQueries({ queryKey: historyKeys.detail(run.id) });
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
