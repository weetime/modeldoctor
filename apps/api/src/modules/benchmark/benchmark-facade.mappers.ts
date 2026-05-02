/**
 * Phase 3 facade (#53) — translates between the legacy /api/benchmarks/*
 * wire shape (BenchmarkRun, CreateBenchmarkRequest) and the unified Run
 * model + RunService. #54 deletes this file when the FE switches to
 * /api/runs.
 */
import type {
  BenchmarkMetricsSummary,
  BenchmarkRun,
  BenchmarkRunSummary,
  CreateBenchmarkRequest,
  CreateRunRequest,
  Run,
} from "@modeldoctor/contracts";
import type { GuidellmParams, GuidellmReport } from "@modeldoctor/tool-adapters";

/**
 * Translate a legacy CreateBenchmarkRequest into the unified CreateRunRequest
 * shape consumed by RunService.create. Adapter zod schema fills the
 * remaining defaults (maxDurationSeconds, maxConcurrency, validateBackend).
 */
export function legacyCreateToCreateRun(body: CreateBenchmarkRequest): CreateRunRequest {
  const params: Record<string, unknown> = {
    profile: body.profile,
    apiType: body.apiType,
    datasetName: body.datasetName,
    requestRate: body.requestRate,
    totalRequests: body.totalRequests,
  };
  if (body.datasetInputTokens !== undefined) params.datasetInputTokens = body.datasetInputTokens;
  if (body.datasetOutputTokens !== undefined) params.datasetOutputTokens = body.datasetOutputTokens;
  if (body.datasetSeed !== undefined) params.datasetSeed = body.datasetSeed;

  return {
    tool: "guidellm",
    kind: "benchmark",
    connectionId: body.connectionId,
    name: body.name,
    description: body.description,
    params,
  };
}

/** Translate a unified Run row into the legacy BenchmarkRun DTO. */
export function runToBenchmarkRun(run: Run): BenchmarkRun {
  const params = (run.params ?? {}) as Partial<GuidellmParams>;
  const scenario = (run.scenario ?? {}) as Record<string, unknown>;
  const summary = run.summaryMetrics as
    | { tool?: string; data?: GuidellmReport }
    | GuidellmReport
    | null
    | undefined;
  const report =
    summary && typeof summary === "object" && "data" in summary && summary.data
      ? (summary.data as GuidellmReport)
      : ((summary as GuidellmReport | null | undefined) ?? null);

  return {
    id: run.id,
    userId: run.userId,
    connectionId: run.connectionId,
    name: run.name ?? "",
    description: run.description,
    profile: (params.profile ?? "custom") as BenchmarkRun["profile"],
    apiType: (params.apiType ?? "chat") as BenchmarkRun["apiType"],
    apiBaseUrl: (scenario.apiBaseUrl as string) ?? "",
    model: (scenario.model as string) ?? "",
    datasetName: (params.datasetName ?? "random") as BenchmarkRun["datasetName"],
    datasetInputTokens: params.datasetInputTokens ?? null,
    datasetOutputTokens: params.datasetOutputTokens ?? null,
    datasetSeed: params.datasetSeed ?? null,
    requestRate: params.requestRate ?? 0,
    totalRequests: params.totalRequests ?? 0,
    state: run.status as BenchmarkRun["state"],
    stateMessage: run.statusMessage,
    progress: run.progress,
    jobName: run.driverHandle,
    metricsSummary: report ? guidellmReportToLegacyMetricsSummary(report) : null,
    rawMetrics: run.rawOutput ?? null,
    logs: run.logs,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}

/** Lightweight summary projection used by GET /benchmarks (list). */
export function runToBenchmarkRunSummary(run: Run): BenchmarkRunSummary {
  const r = runToBenchmarkRun(run);
  return {
    id: r.id,
    userId: r.userId,
    connectionId: r.connectionId,
    name: r.name,
    profile: r.profile,
    apiType: r.apiType,
    apiBaseUrl: r.apiBaseUrl,
    model: r.model,
    datasetName: r.datasetName,
    state: r.state,
    progress: r.progress,
    metricsSummary: r.metricsSummary,
    createdAt: r.createdAt,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
  };
}

/**
 * Strip the p90 field that GuidellmReport carries but the legacy
 * BenchmarkMetricsSummary contract does not expose. Otherwise the shapes
 * line up.
 */
export function guidellmReportToLegacyMetricsSummary(
  data: GuidellmReport,
): BenchmarkMetricsSummary {
  const dist = (d: GuidellmReport["ttft"]) => ({
    mean: d.mean,
    p50: d.p50,
    p95: d.p95,
    p99: d.p99,
  });
  return {
    ttft: dist(data.ttft),
    itl: dist(data.itl),
    e2eLatency: dist(data.e2eLatency),
    requestsPerSecond: data.requestsPerSecond,
    outputTokensPerSecond: data.outputTokensPerSecond,
    inputTokensPerSecond: data.inputTokensPerSecond,
    totalTokensPerSecond: data.totalTokensPerSecond,
    concurrency: data.concurrency,
    requests: data.requests,
  };
}
