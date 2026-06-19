import type { Benchmark, ScenarioId } from "@modeldoctor/contracts";
import { useQueries } from "@tanstack/react-query";
import { ArrowLeft, ListChecks } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { benchmarkApi } from "../api";
import { benchmarkKeys } from "../queries";
import { CompareToolbar } from "./CompareToolbar";
import { type ReportRun, ReportSections } from "./ReportSections";
import { shortRunLabels } from "./run-label";
import { SaveCompareDialog } from "./SaveCompareDialog";

function extractParamsSummary(params: unknown): { concurrency?: number } {
  if (!params || typeof params !== "object") return {};
  const p = params as Record<string, unknown>;
  return {
    concurrency: typeof p.concurrency === "number" ? p.concurrency : undefined,
  };
}

const SCENARIO_SIDEBAR_KEY: Record<ScenarioId, string> = {
  inference: "benchmarkInference",
  capacity: "benchmarkCapacity",
  gateway: "benchmarkGateway",
  "lb-strategy": "benchmarkPrefixCache",
  "engine-kv-cache": "benchmarkKvCacheStress",
};

function parseIds(searchParams: URLSearchParams): string[] {
  const raw = searchParams.get("ids") ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function BenchmarkComparePage() {
  const { t } = useTranslation("benchmarks");
  const { t: tSidebar } = useTranslation("sidebar");
  const [searchParams, setSearchParams] = useSearchParams();
  const [saveOpen, setSaveOpen] = useState(false);
  const [generateAfterSave, setGenerateAfterSave] = useState(false);
  const ids = useMemo(() => parseIds(searchParams), [searchParams]);
  // URL baseline param has three possible meanings:
  //   - missing            → "user hasn't chosen yet, fall back to inferred default"
  //   - "none"             → "user explicitly chose None — do not infer"
  //   - <a cuid in `ids`>  → "user chose this Benchmark as baseline"
  // The "none" sentinel is needed because without it, the inferred default
  // (first Benchmark with baselineFor !== null) would silently override a
  // user's None selection on the next render.
  const baselineParam = searchParams.get("baseline");

  // Gate fetches at the array level: if the user lands on /benchmarks/compare with
  // 0 or 1 ids (manual URL edit / shared half-baked link), the empty state
  // renders below — but useQueries runs unconditionally at the hook level, so
  // the query.enabled flag must also be false to avoid firing a real GET
  // before the early-return is reached. See PR review on Task 7.
  const canFetch = ids.length >= 2;
  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: benchmarkKeys.detail(id),
      queryFn: () => benchmarkApi.get(id),
      enabled: canFetch && id.length > 0,
      retry: false,
    })),
  });

  const successfulBenchmarks: Benchmark[] = queries
    .map((q) => q.data)
    .filter((b): b is Benchmark => !!b);
  const failedCount = queries.filter((q) => q.isError).length;
  const isLoading = queries.some((q) => q.isLoading);

  const backScenario = (successfulBenchmarks[0]?.scenario ?? "gateway") as ScenarioId;
  const backHref = `/benchmarks/${backScenario}`;
  const breadcrumbs = [
    { label: tSidebar("groups.benchmarks") },
    {
      label: tSidebar(`items.${SCENARIO_SIDEBAR_KEY[backScenario]}`),
      to: backHref,
    },
    { label: t("compare.title") },
  ];

  const tools = new Set(successfulBenchmarks.map((r) => r.tool));
  const isMixed = tools.size > 1;

  // Mixed-scenario gate. Mirrors the mixed-tools gate one line up: if the
  // user crafted a URL with `?ids=` spanning >1 scenario (e.g. an inference
  // run + a gateway run), the metric grid would compare metrics that don't
  // share a definition — block rendering with a destructive alert instead.
  const scenarios = new Set(successfulBenchmarks.map((r) => r.scenario));
  const isMixedScenarios = scenarios.size > 1;

  // Default baseline:
  //   - URL "none" sentinel → user explicitly chose None
  //   - URL has a cuid that matches one of the benchmarks → that one is baseline
  //   - URL has a cuid that doesn't match → null (URL went stale)
  //   - URL missing → infer from first Benchmark with baselineFor !== null
  const defaultBaseline = useMemo(() => {
    if (baselineParam === "none") return null;
    if (baselineParam && successfulBenchmarks.some((r) => r.id === baselineParam))
      return baselineParam;
    if (baselineParam) return null;
    const inferred = successfulBenchmarks.find((r) => r.baselineFor !== null);
    return inferred?.id ?? null;
  }, [baselineParam, successfulBenchmarks]);

  function handleBaselineChange(next: string | null) {
    const sp = new URLSearchParams();
    if (ids.length > 0) sp.set("ids", ids.join(","));
    // Always write a baseline param so user-explicit None survives across
    // re-renders. "none" is the sentinel for explicit None selection.
    sp.set("baseline", next ?? "none");
    setSearchParams(sp);
  }

  // Unreachable path: BenchmarkCompareGate routes empty `ids` to
  // /benchmarks/inference before this component renders. Defensive
  // null fallback in case the page is mounted directly somehow.
  if (ids.length === 0) {
    return null;
  }
  if (ids.length < 2) {
    return (
      <>
        <PageHeader title={t("compare.title")} breadcrumbs={breadcrumbs} />
        <EmptyState
          icon={ListChecks}
          title={t("compare.needTwoEmpty")}
          actions={
            <Button asChild variant="outline" size="sm">
              <Link to={backHref}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                {t("compare.back")}
              </Link>
            </Button>
          }
        />
      </>
    );
  }

  // Hide the tool name in the subtitle when the selection mixes tools or
  // scenarios — the alert below already explains the situation; including a
  // single tool name in the subtitle would lie about the other Benchmark(s).
  const subtitle =
    successfulBenchmarks.length > 0 && !isMixed && !isMixedScenarios
      ? t("compare.subtitle", {
          n: successfulBenchmarks.length,
          tool: successfulBenchmarks[0].tool,
        })
      : "";

  // Short, distinguishing labels for charts/legends/matrix: strip the long
  // prefix all runs share (e.g. "deep-chat-t2 · Qwen3-8B · "), keeping only what
  // differs ("MX-OFF-r1-a1"). Falls back to the full name when nothing is shared.
  const runNames = successfulBenchmarks.map((b, i) => b.name ?? `R${i + 1}`);
  const shortLabels = shortRunLabels(runNames);
  const reportRuns: ReportRun[] = successfulBenchmarks.map((b, i) => ({
    id: b.id,
    stageLabel: shortLabels[i],
    tool: b.tool,
    scenario: b.scenario,
    summaryMetrics: b.summaryMetrics,
    serverMetrics: b.serverMetrics,
    benchmark: b,
    paramsSummary: extractParamsSummary(b.params),
  }));
  const environmentLines = successfulBenchmarks.map(
    (b) => `${b.name ?? b.id} · ${b.tool} · ${b.scenario}`,
  );

  return (
    <>
      <PageHeader title={t("compare.title")} subtitle={subtitle} breadcrumbs={breadcrumbs} />
      <div className="space-y-6 px-8 py-6">
        {failedCount > 0 && (
          <Alert>
            <AlertDescription>
              {t("compare.baselineMissing", {
                failed: failedCount,
                n: successfulBenchmarks.length,
              })}
            </AlertDescription>
          </Alert>
        )}
        {isMixed && (
          <Alert variant="destructive">
            <AlertTitle>{t("compare.mixedToolsTitle")}</AlertTitle>
            <AlertDescription>
              {t("compare.mixedToolsBody", { summary: [...tools].join(" + ") })}
            </AlertDescription>
          </Alert>
        )}
        {isMixedScenarios && (
          <Alert variant="destructive">
            <AlertTitle>{t("compare.mixedScenariosTitle")}</AlertTitle>
            <AlertDescription>
              {t("compare.mixedScenariosBody", {
                scenarios: [...scenarios].join(", "),
              })}
            </AlertDescription>
          </Alert>
        )}
        {!isLoading && !isMixed && !isMixedScenarios && successfulBenchmarks.length >= 2 && (
          <>
            <CompareToolbar
              runs={successfulBenchmarks.map((r) => ({ id: r.id, name: r.name, tool: r.tool }))}
              baselineId={defaultBaseline}
              onBaselineChange={handleBaselineChange}
            />
            <div className="flex items-center justify-between">
              <Button variant="outline" asChild>
                <Link to="/benchmarks/compare/saved">{t("savedCompare.savedListLink")}</Link>
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setGenerateAfterSave(false);
                    setSaveOpen(true);
                  }}
                >
                  {t("savedCompare.compare.saveOnly")}
                </Button>
                <Button
                  onClick={() => {
                    setGenerateAfterSave(true);
                    setSaveOpen(true);
                  }}
                >
                  {t("savedCompare.compare.generate")}
                </Button>
              </div>
            </div>
            <ReportSections
              runs={reportRuns}
              baselineId={defaultBaseline}
              narrative={null}
              context={null}
              environmentLines={environmentLines}
              onReorder={(newIds) => {
                // URL ids order is the single source of run order — tables,
                // charts and SaveCompareDialog all follow it via useQueries.
                const sp = new URLSearchParams(searchParams);
                sp.set("ids", newIds.join(","));
                setSearchParams(sp, { replace: true });
              }}
            />
            <SaveCompareDialog
              open={saveOpen}
              onOpenChange={setSaveOpen}
              runs={successfulBenchmarks.map((r) => ({ id: r.id, name: r.name, tool: r.tool }))}
              baselineId={defaultBaseline}
              context=""
              generateAfterSave={generateAfterSave}
            />
          </>
        )}
      </div>
    </>
  );
}
