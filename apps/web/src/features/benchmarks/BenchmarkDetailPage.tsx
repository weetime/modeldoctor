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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDeleteBaseline } from "@/features/baseline/queries";
import type { Benchmark } from "@modeldoctor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, Loader2, RefreshCw, SearchX } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { BenchmarkDetailMetadata } from "./BenchmarkDetailMetadata";
import { BenchmarkDetailRawOutput } from "./BenchmarkDetailRawOutput";
import { SetBaselineDialog } from "./SetBaselineDialog";
import { DetailVerdictRow } from "./compare/DetailVerdictRow";
import {
  benchmarkKeys,
  isTerminalStatus,
  useBenchmarkDetail,
  useCancelBenchmark,
  useCreateBenchmark,
  useDeleteBenchmark,
} from "./queries";
import { BenchmarkChartsSection } from "./reports/BenchmarkChartsSection";
import { CapacityReport } from "./reports/CapacityReport";
import { GatewayReport } from "./reports/GatewayReport";
import { InferenceReport } from "./reports/InferenceReport";
import { UnknownReport } from "./reports/UnknownReport";

/**
 * Pre-terminal placeholder rendered while the benchmark is still in flight.
 * Polls via `useBenchmarkDetail`; once the backend writes a terminal status
 * the parent flips to the metrics + raw-output report layout.
 */
function RunningSection({ benchmark }: { benchmark: Benchmark }) {
  const { t } = useTranslation("benchmarks");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, []);

  const startedAt = benchmark.startedAt ?? benchmark.createdAt;
  const elapsedSec = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const isPending = benchmark.status === "pending" || benchmark.status === "submitted";

  return (
    <output
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border p-12 text-center"
    >
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" strokeWidth={1.5} />
      <div className="text-sm font-medium">
        {isPending ? t("detail.running.pending") : t("detail.running.title")}
      </div>
      <div className="text-xs text-muted-foreground tabular-nums">
        {t("detail.running.elapsed", { sec: elapsedSec })}
      </div>
    </output>
  );
}

function ReportSection({ benchmark }: { benchmark: Benchmark }) {
  const { t } = useTranslation("benchmarks");
  if (!benchmark.summaryMetrics) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {t("detail.metrics.empty")}
      </div>
    );
  }
  switch (benchmark.scenario) {
    case "inference":
      return <InferenceReport benchmark={benchmark} />;
    case "capacity":
      return <CapacityReport benchmark={benchmark} />;
    case "gateway":
      return <GatewayReport benchmark={benchmark} />;
    default:
      return <UnknownReport benchmark={benchmark} />;
  }
}

export function BenchmarkDetailPage() {
  const { t } = useTranslation("benchmarks");
  const { id } = useParams<{ id: string }>();
  const { data: benchmark, isLoading, isError, error } = useBenchmarkDetail(id ?? "");
  const qc = useQueryClient();

  const [setOpen, setSetOpen] = useState(false);
  const [unsetOpen, setUnsetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const remove = useDeleteBaseline();
  const deleteBenchmark = useDeleteBenchmark();
  const cancelBenchmark = useCancelBenchmark();
  const createBenchmark = useCreateBenchmark();
  const navigate = useNavigate();

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

  if (!benchmark) return null;

  const subtitle = t("detail.subtitle", {
    scenario: benchmark.scenario,
    tool: benchmark.tool,
    when: format(new Date(benchmark.createdAt), "yyyy-MM-dd HH:mm"),
  });

  const isBaseline = benchmark.baselineFor !== null;
  const isTerminal = isTerminalStatus(benchmark.status);
  // CreateBenchmarkRequest requires non-null connectionId; orphaned benchmarks
  // (FK SET NULL after Connection delete) cannot be cloned without picking a
  // new connection, and the spec is one-click rerun without an edit step.
  const canRerun = benchmark.connectionId !== null;

  async function handleRerun() {
    if (!benchmark || !benchmark.connectionId) return;
    // Schema caps name at 128. " (rerun)" is 8 chars; reserve 120 for the source.
    const sourceName = benchmark.name;
    const trimmed = sourceName.length > 120 ? sourceName.slice(0, 120) : sourceName;
    const newName = `${trimmed} (rerun)`;
    try {
      const next = await createBenchmark.mutateAsync({
        tool: benchmark.tool,
        scenario: benchmark.scenario,
        connectionId: benchmark.connectionId,
        name: newName,
        description: benchmark.description ?? undefined,
        params: benchmark.params,
      });
      toast.success(t("detail.rerun.success", { name: next.name }));
      navigate(`/benchmarks/${next.id}`);
    } catch (e) {
      toast.error((e as Error).message || t("detail.rerun.errors.generic"));
    }
  }

  return (
    <>
      <PageHeader
        title={benchmark.name}
        subtitle={subtitle}
        rightSlot={
          <div className="flex items-center gap-2">
            {isTerminal &&
              (isBaseline ? (
                <Button variant="secondary" size="sm" onClick={() => setUnsetOpen(true)}>
                  {t("detail.baseline.unsetButton")}
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setSetOpen(true)}>
                  {t("detail.baseline.setButton")}
                </Button>
              ))}
            {isTerminal &&
              (canRerun ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRerun}
                  disabled={createBenchmark.isPending}
                >
                  <RefreshCw className="mr-1 h-4 w-4" />
                  {t("detail.rerun.button")}
                </Button>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button variant="outline" size="sm" disabled={true}>
                        <RefreshCw className="mr-1 h-4 w-4" />
                        {t("detail.rerun.button")}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t("detail.rerun.connectionMissingTooltip")}</TooltipContent>
                </Tooltip>
              ))}
            {!isTerminal && (
              <Button variant="outline" size="sm" onClick={() => setCancelOpen(true)}>
                {t("detail.cancel.button")}
              </Button>
            )}
            <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
              {t("detail.delete.button")}
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to={`/benchmarks/${benchmark.scenario}`}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                {t("detail.back")}
              </Link>
            </Button>
          </div>
        }
      />
      <div className="space-y-8 px-8 py-6">
        <section>
          <BenchmarkDetailMetadata benchmark={benchmark} />
        </section>
        {benchmark.status === "failed" && benchmark.statusMessage && (
          <Alert variant="destructive">
            <AlertTitle>{t("detail.statusMessage.title")}</AlertTitle>
            <AlertDescription>
              <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                {benchmark.statusMessage}
              </pre>
            </AlertDescription>
          </Alert>
        )}
        {isTerminal ? (
          <>
            {benchmark.baselineId && (
              <section>
                <DetailVerdictRow benchmark={benchmark} baselineId={benchmark.baselineId} />
              </section>
            )}
            <section>
              <h3 className="mb-3 text-sm font-semibold">{t("detail.metrics.title")}</h3>
              <ReportSection benchmark={benchmark} />
            </section>
            <section>
              <h3 className="mb-3 text-sm font-semibold">{t("detail.charts.title")}</h3>
              <BenchmarkChartsSection benchmarkId={benchmark.id} tool={benchmark.tool} />
            </section>
            <section>
              <BenchmarkDetailRawOutput
                rawOutput={benchmark.rawOutput as Record<string, unknown> | null}
                logs={benchmark.logs}
              />
            </section>
          </>
        ) : (
          <RunningSection benchmark={benchmark} />
        )}
      </div>

      <SetBaselineDialog
        benchmarkId={benchmark.id}
        open={setOpen}
        onOpenChange={setSetOpen}
        onSuccess={() => qc.invalidateQueries({ queryKey: benchmarkKeys.detail(benchmark.id) })}
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
                if (benchmark.baselineFor) {
                  remove.mutate(benchmark.baselineFor.id, {
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

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("detail.delete.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("detail.delete.confirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("detail.baseline.dialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                deleteBenchmark.mutate(benchmark.id, {
                  onSuccess: () => {
                    setDeleteOpen(false);
                    toast.success(t("detail.delete.success"));
                    navigate("/benchmarks");
                  },
                  onError: () => {
                    toast.error(t("detail.delete.errors.generic"));
                  },
                });
              }}
              disabled={deleteBenchmark.isPending}
            >
              {t("detail.delete.confirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("detail.cancel.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("detail.cancel.confirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("detail.cancel.dismiss")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                cancelBenchmark.mutate(benchmark.id, {
                  onSuccess: () => {
                    toast.success(t("detail.cancel.success"));
                    setCancelOpen(false);
                  },
                  onError: () => {
                    toast.error(t("detail.cancel.errors.generic"));
                  },
                });
              }}
              disabled={cancelBenchmark.isPending}
            >
              {t("detail.cancel.confirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
