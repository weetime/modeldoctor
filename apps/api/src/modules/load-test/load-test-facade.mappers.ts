/**
 * Phase 3 facade (#53) — translates between the legacy /api/load-test/*
 * wire shape (LoadTestRequest, LoadTestResponse) and the unified Run
 * model + RunService. #54 deletes this file when the FE switches to
 * /api/runs.
 */
import type {
  CreateRunRequest,
  LoadTestParsed,
  LoadTestRequest,
  LoadTestResponse,
  Run,
} from "@modeldoctor/contracts";
import type { VegetaReport } from "@modeldoctor/tool-adapters";

/**
 * Translate a legacy LoadTestRequest into the unified CreateRunRequest
 * shape consumed by RunService.create. We default `apiType` to "chat"
 * here (LoadTestRequestSchema makes it optional, but VegetaParams
 * requires it) so RunService's adapter.paramsSchema.parse always sees
 * a fully-populated record.
 *
 * Typed as `Record<string, unknown>` rather than `VegetaParams` because
 * `CreateRunRequest.params` is itself `Record<string, unknown>` — the
 * tool adapter's zod schema does the strict shape check downstream.
 * Same convention as benchmark-facade.mappers.ts (Task 3.5).
 */
export function legacyToCreateRun(req: LoadTestRequest, name: string): CreateRunRequest {
  const params: Record<string, unknown> = {
    apiType: req.apiType ?? "chat",
    rate: req.rate,
    duration: req.duration,
  };
  return {
    tool: "vegeta",
    kind: "benchmark",
    connectionId: req.connectionId,
    name,
    params,
  };
}

/**
 * Translate a unified Run row into the legacy LoadTestResponse DTO.
 *
 * Two non-obvious bits:
 *
 * 1. `summaryMetrics` is written by RunCallbackController.handleFinish
 *    as the adapter's `{ tool, data }` envelope — see
 *    packages/tool-adapters/src/vegeta/runtime.ts parseFinalReport.
 *    Anything else is malformed and we return all-null parsed fields
 *    rather than guess.
 *
 * 2. `rawOutput.files.report` is base64-encoded by the runner per
 *    runFinishCallbackSchema; decode to UTF-8 text so the FE can show
 *    the legacy `vegeta report` text output.
 */
export function runToLoadTestResponse(run: Run): LoadTestResponse {
  const sm = run.summaryMetrics as { tool: "vegeta"; data: VegetaReport } | null | undefined;
  const isEnvelope =
    sm != null && typeof sm === "object" && "tool" in sm && "data" in sm && sm.data != null;
  const data = isEnvelope ? sm.data : null;

  const raw = run.rawOutput as
    | { stdout?: string; stderr?: string; files?: Record<string, string> }
    | null
    | undefined;
  const reportFile = raw?.files?.report;
  const reportText = reportFile ? Buffer.from(reportFile, "base64").toString("utf8") : "";

  const parsed: LoadTestParsed = {
    requests: data?.requests.total ?? null,
    success: data?.success ?? null,
    throughput: data?.requests.throughput ?? null,
    latencies: {
      mean: data ? `${data.latencies.mean}ms` : null,
      p50: data ? `${data.latencies.p50}ms` : null,
      p95: data ? `${data.latencies.p95}ms` : null,
      p99: data ? `${data.latencies.p99}ms` : null,
      max: data ? `${data.latencies.max}ms` : null,
    },
  };

  const scenario = (run.scenario ?? {}) as Record<string, unknown>;
  const params = (run.params ?? {}) as Record<string, unknown>;

  return {
    success: true,
    runId: run.id,
    report: reportText,
    parsed,
    config: {
      apiType: (params.apiType as LoadTestResponse["config"]["apiType"]) ?? "chat",
      apiBaseUrl: (scenario.apiBaseUrl as string) ?? "",
      model: (scenario.model as string) ?? "",
      rate: (params.rate as number) ?? 0,
      duration: (params.duration as number) ?? 0,
    },
  };
}
