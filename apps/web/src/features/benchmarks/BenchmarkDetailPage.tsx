import type { Benchmark, ConnectionPublic, ScenarioId } from "@modeldoctor/contracts";
import { migrateVegetaParams } from "@modeldoctor/tool-adapters/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Copy, Loader2, RefreshCw, SearchX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/common/confirm-delete-dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDeleteBaseline } from "@/features/baseline/queries";
import { useConnection } from "@/features/connections/queries";
import { EngineMetricsSection } from "@/features/engine-metrics/EngineMetricsSection";
import { useSidebarStore } from "@/stores/sidebar-store";
import { BenchmarkDetailMetadata } from "./BenchmarkDetailMetadata";
import { BenchmarkDetailRawOutput } from "./BenchmarkDetailRawOutput";
import { DetailVerdictRow } from "./compare/DetailVerdictRow";
import {
  benchmarkKeys,
  isTerminalStatus,
  useBenchmarkDetail,
  useCancelBenchmark,
  useCreateBenchmark,
  useDeleteBenchmark,
} from "./queries";
import { RequestSetupSection } from "./RequestSetupSection";
import { BenchmarkChartsSection } from "./reports/BenchmarkChartsSection";
import { CapacityReport } from "./reports/CapacityReport";
import { GatewayReport } from "./reports/GatewayReport";
import { InferenceReport } from "./reports/InferenceReport";
import { KvCacheStressReport } from "./reports/KvCacheStressReport";
import { PrefixCachePanel } from "./reports/PrefixCachePanel";
import { UnknownReport } from "./reports/UnknownReport";
import { SaveAsTemplateDialog } from "./SaveAsTemplateDialog";
import { SetBaselineDialog } from "./SetBaselineDialog";
import { type LogEvent, useRunEventStream } from "./useRunEventStream";

/** Spinner + elapsed time shown in the Overview tab while a run is in flight. */
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

/** Dark terminal-style log panel. Shows live SSE lines during a run; the
 *  combined stdout+stderr from rawOutput after completion. Survives page
 *  refresh via the DB fallback. */
function LogPanel({
  logLines,
  stdout,
  stderr,
}: {
  logLines: LogEvent[];
  stdout: string;
  stderr: string;
}) {
  const { t } = useTranslation("benchmarks");
  const logEndRef = useRef<HTMLDivElement>(null);

  // Post-mortem the runner stores stdout and stderr as separate S3 objects, so
  // chronological interleaving is lost — show stdout then stderr. Many tools
  // log entirely to one stream (guidellm/evalscope write to stderr), so the
  // panel must render both or a successful run looks empty.
  const stored = [stdout, stderr]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n");

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [logLines, stored]);

  const hasLive = logLines.length > 0;
  const hasStored = stored.length > 0;

  if (!hasLive && !hasStored) {
    return (
      <div className="flex h-48 items-center justify-center rounded-md border border-border bg-zinc-950 px-6 text-center text-xs text-zinc-500">
        {t("detail.logs.empty")}
      </div>
    );
  }

  if (hasStored) {
    return (
      <pre className="max-h-[60vh] min-h-48 overflow-auto rounded-md bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-200 whitespace-pre-wrap break-all">
        {stored}
        <div ref={logEndRef} />
      </pre>
    );
  }

  return (
    <pre className="max-h-[60vh] min-h-48 overflow-auto rounded-md bg-zinc-950 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
      {logLines.map((l, i) => (
        <span
          key={i}
          className={
            l.level === "error"
              ? "text-red-400"
              : l.level === "warn"
                ? "text-yellow-400"
                : "text-zinc-200"
          }
        >
          {l.line}
          {"\n"}
        </span>
      ))}
      <div ref={logEndRef} />
    </pre>
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
    case "lb-strategy":
      return (
        <div className="space-y-6">
          <InferenceReport benchmark={benchmark} />
          <PrefixCachePanel serverMetrics={benchmark.serverMetrics} />
        </div>
      );
    case "engine-kv-cache":
      return <KvCacheStressReport benchmark={benchmark} />;
    default:
      return <UnknownReport benchmark={benchmark} />;
  }
}

function BenchmarkDetailTabs({
  benchmark,
  connection,
  logLines,
}: {
  benchmark: Benchmark;
  connection: ConnectionPublic | null;
  logLines: LogEvent[];
}) {
  const { t } = useTranslation("benchmarks");
  const isTerminal = isTerminalStatus(benchmark.status);
  const showCharts = isTerminal;
  // Engine Metrics is reachable when the connection is bound to a Prometheus
  // datasource and the benchmark has a definite time window.
  const showEngineMetrics = Boolean(
    isTerminal &&
      connection?.prometheusDatasource &&
      connection.serverKind &&
      benchmark.startedAt &&
      benchmark.completedAt,
  );
  const [active, setActive] = useState<string>("overview");

  const rawLogs = benchmark.rawOutput as { stdout?: string; stderr?: string } | null;
  const stdout = rawLogs?.stdout ?? "";
  const stderr = rawLogs?.stderr ?? "";

  return (
    <Tabs value={active} onValueChange={setActive} className="w-full">
      <TabsList>
        <TabsTrigger value="overview">{t("detail.tabs.overview")}</TabsTrigger>
        {showCharts && <TabsTrigger value="charts">{t("detail.charts.title")}</TabsTrigger>}
        {showEngineMetrics && (
          <TabsTrigger value="engine">{t("detail.engineMetrics.title")}</TabsTrigger>
        )}
        <TabsTrigger value="logs">{t("detail.tabs.logs")}</TabsTrigger>
        {isTerminal && <TabsTrigger value="request">{t("detail.tabs.request")}</TabsTrigger>}
      </TabsList>

      <TabsContent value="overview" className="space-y-6">
        {isTerminal ? (
          <>
            {benchmark.baselineId && (
              <DetailVerdictRow benchmark={benchmark} baselineId={benchmark.baselineId} />
            )}
            <section>
              <h3 className="mb-3 text-sm font-semibold">{t("detail.metrics.title")}</h3>
              <ReportSection benchmark={benchmark} />
            </section>
          </>
        ) : (
          <RunningSection benchmark={benchmark} />
        )}
      </TabsContent>

      {showCharts && (
        <TabsContent value="charts" className="space-y-6">
          <BenchmarkChartsSection benchmarkId={benchmark.id} tool={benchmark.tool} />
        </TabsContent>
      )}

      {showEngineMetrics && benchmark.startedAt && benchmark.completedAt && connection && (
        <TabsContent value="engine" className="space-y-6">
          <EngineMetricsSection
            connectionId={connection.id}
            startedAt={benchmark.startedAt}
            finishedAt={benchmark.completedAt}
          />
        </TabsContent>
      )}

      <TabsContent value="logs">
        <LogPanel logLines={logLines} stdout={stdout} stderr={stderr} />
      </TabsContent>

      {isTerminal && (
        <TabsContent value="request" className="space-y-6">
          <RequestSetupSection benchmark={benchmark} />
          <BenchmarkDetailRawOutput
            rawOutput={benchmark.rawOutput as Record<string, unknown> | null}
            logs={benchmark.logs}
          />
        </TabsContent>
      )}
    </Tabs>
  );
}

/** Map scenario id → sidebar i18n key for breadcrumb labels. */
const SCENARIO_SIDEBAR_KEY: Record<ScenarioId, string> = {
  inference: "benchmarkInference",
  capacity: "benchmarkCapacity",
  gateway: "benchmarkGateway",
  "lb-strategy": "benchmarkPrefixCache",
  "engine-kv-cache": "benchmarkKvCacheStress",
};

export function BenchmarkDetailPage() {
  const { t } = useTranslation("benchmarks");
  const { t: tSidebar } = useTranslation("sidebar");
  const { id } = useParams<{ id: string }>();
  const { data: benchmark, isLoading, isError, error } = useBenchmarkDetail(id ?? "");
  // Loaded eagerly so the rerun handler can substitute the current
  // connection model into legacy params (those that lack `body`). This
  // also primes the cache for the RequestDetailsSection rendered below.
  const { data: rerunConnection } = useConnection(benchmark?.connectionId ?? null);
  const qc = useQueryClient();

  const [setOpen, setSetOpen] = useState(false);
  const [unsetOpen, setUnsetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  const remove = useDeleteBaseline();
  const deleteBenchmark = useDeleteBenchmark();
  const cancelBenchmark = useCancelBenchmark();
  const createBenchmark = useCreateBenchmark();
  const navigate = useNavigate();
  const setActivePath = useSidebarStore((s) => s.setActivePath);

  const scenario = benchmark?.scenario;
  useEffect(() => {
    if (!scenario) return;
    setActivePath(`/benchmarks/${scenario}`);
    return () => setActivePath(null);
  }, [scenario, setActivePath]);

  const isTerminal = benchmark ? isTerminalStatus(benchmark.status) : true;
  const logLines = useRunEventStream(benchmark?.id, !isTerminal);

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
  // CreateBenchmarkRequest requires non-null connectionId; orphaned benchmarks
  // (FK SET NULL after Connection delete) cannot be cloned without picking a
  // new connection, and the spec is one-click rerun without an edit step.
  const canRerun = benchmark.connectionId !== null;

  async function handleRerun() {
    if (!benchmark?.connectionId) return;
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
        params:
          benchmark.tool === "vegeta"
            ? (migrateVegetaParams(
                benchmark.params as Parameters<typeof migrateVegetaParams>[0],
                rerunConnection?.model ?? null,
              ) as unknown as Record<string, unknown>)
            : benchmark.params,
      });
      toast.success(t("detail.rerun.success", { name: next.name }));
      navigate(`/benchmarks/${next.id}`);
    } catch (e) {
      toast.error((e as Error).message || t("detail.rerun.errors.generic"));
    }
  }

  const breadcrumbs = [
    { label: tSidebar("groups.benchmarks") },
    {
      label: tSidebar(`items.${SCENARIO_SIDEBAR_KEY[benchmark.scenario as ScenarioId]}`),
      to: `/benchmarks/${benchmark.scenario}`,
    },
    { label: benchmark.name },
  ];

  return (
    <>
      <PageHeader
        title={benchmark.name}
        subtitle={subtitle}
        breadcrumbs={breadcrumbs}
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
            {isTerminal && benchmark.status === "completed" && (
              <Button variant="outline" size="sm" onClick={() => setSaveTplOpen(true)}>
                <Copy className="mr-1 h-4 w-4" />
                {t("detail.saveAsTemplate.button")}
              </Button>
            )}
            {!isTerminal && (
              <Button variant="outline" size="sm" onClick={() => setCancelOpen(true)}>
                {t("detail.cancel.button")}
              </Button>
            )}
            <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
              {t("detail.delete.button")}
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
        {benchmark.status === "failed" && (
          <details className="mt-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
              {t("detail.failure.toggleStderr")}
            </summary>
            {(() => {
              const stderr = (benchmark.rawOutput as { stderr?: string } | null)?.stderr ?? "";
              if (!stderr.trim()) {
                return (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("detail.failure.stderrEmpty")}
                  </p>
                );
              }
              const lines = stderr.split("\n");
              const tail = lines.slice(-200).join("\n");
              return (
                <pre className="mt-2 max-h-80 overflow-auto rounded bg-background p-3 text-xs">
                  {tail}
                </pre>
              );
            })()}
          </details>
        )}
        <BenchmarkDetailTabs
          benchmark={benchmark}
          connection={rerunConnection ?? null}
          logLines={logLines}
        />
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

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("detail.delete.confirmTitle")}
        description={t("detail.delete.confirmBody")}
        confirmLabel={t("detail.delete.confirmAction")}
        pending={deleteBenchmark.isPending}
        onConfirm={() => {
          deleteBenchmark.mutate(benchmark.id, {
            onSuccess: () => {
              setDeleteOpen(false);
              toast.success(t("detail.delete.success"));
              // Mirror "back to list" — keep the user in the same scenario
              // tab they came from, not the default inference list.
              navigate(`/benchmarks/${benchmark.scenario}`);
            },
            onError: () => {
              toast.error(t("detail.delete.errors.generic"));
            },
          });
        }}
      />

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

      <SaveAsTemplateDialog
        benchmark={saveTplOpen ? benchmark : null}
        onOpenChange={setSaveTplOpen}
      />
    </>
  );
}
