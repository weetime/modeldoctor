import { useConnection } from "@/features/connections/queries";
import type { Benchmark, BenchmarkTool } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import { RequestDetailsSection } from "./RequestDetailsSection";

interface Props {
  benchmark: Benchmark;
}

/**
 * Cross-tool "what was sent" view.
 *
 * vegeta has a literal request body and reuses RequestDetailsSection (with
 * Copy-as-cURL replay). Wrapper-driven tools (guidellm / prefix-cache-probe)
 * synthesize requests at runtime from a config; for those we render the
 * endpoint + headers + the run config that drove generation, not a
 * fabricated example body.
 */
export function RequestSetupSection({ benchmark }: Props) {
  if (benchmark.tool === "vegeta") {
    return <RequestDetailsSection benchmark={benchmark} />;
  }
  return <SynthesizedRequestSetup benchmark={benchmark} />;
}

interface ParamRow {
  label: string;
  value: string;
}

function inferEndpoint(
  tool: BenchmarkTool,
  params: Record<string, unknown>,
): {
  method: string;
  path: string;
} {
  switch (tool) {
    case "guidellm":
      return {
        method: "POST",
        path: params.apiType === "chat" ? "/v1/chat/completions" : "/v1/completions",
      };
    case "prefix-cache-probe":
      return { method: "POST", path: "/v1/chat/completions" };
    case "evalscope": {
      const p = typeof params.apiPath === "string" ? params.apiPath : "/v1/chat/completions";
      return { method: "POST", path: p };
    }
    case "aiperf":
      return {
        method: "POST",
        path: params.endpointType === "completions" ? "/v1/completions" : "/v1/chat/completions",
      };
    default:
      return { method: "POST", path: "" };
  }
}

function buildParamRows(
  tool: BenchmarkTool,
  params: Record<string, unknown>,
  t: (key: string) => string,
): ParamRow[] {
  const k = (suffix: string) => t(`detail.requestSetup.params.${suffix}`);
  switch (tool) {
    case "guidellm": {
      const rows: ParamRow[] = [
        { label: k("profile"), value: String(params.profile ?? "—") },
        { label: k("apiType"), value: String(params.apiType ?? "—") },
        { label: k("dataset"), value: String(params.datasetName ?? "—") },
        {
          label: k("rate"),
          value:
            params.requestRate && Number(params.requestRate) > 0
              ? `${params.rateType} @ ${params.requestRate} rps`
              : String(params.rateType ?? "—"),
        },
        { label: k("totalRequests"), value: String(params.totalRequests ?? "—") },
        { label: k("maxConcurrency"), value: String(params.maxConcurrency ?? "—") },
      ];
      if (params.datasetName === "random") {
        rows.push({
          label: k("inputTokens"),
          value: String(params.datasetInputTokens ?? "—"),
        });
        rows.push({
          label: k("outputTokens"),
          value: String(params.datasetOutputTokens ?? "—"),
        });
      }
      return rows;
    }
    case "prefix-cache-probe":
      return [
        { label: k("promptSets"), value: String(params.promptSets ?? "—") },
        { label: k("requestsPerSet"), value: String(params.requestsPerSet ?? "—") },
        { label: k("maxTokens"), value: String(params.maxTokens ?? "—") },
        {
          label: k("promBackoff"),
          value: `${params.promBackoffSec ?? "—"}s`,
        },
      ];
    default:
      return [];
  }
}

function SynthesizedRequestSetup({ benchmark }: Props) {
  const { t } = useTranslation("benchmarks");
  const { data: connection, isLoading } = useConnection(benchmark.connectionId);

  if (!benchmark.connectionId || (!isLoading && !connection)) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("detail.requestDetails.connectionMissing")}
      </p>
    );
  }
  if (isLoading || !connection) {
    return <p className="text-sm text-muted-foreground">{t("detail.requestDetails.loading")}</p>;
  }

  const params = (benchmark.params ?? {}) as Record<string, unknown>;
  const { method, path } = inferEndpoint(benchmark.tool, params);
  const url = connection.baseUrl.replace(/\/+$/, "") + path;
  const displayHeaders = [
    "Content-Type: application/json",
    `Authorization: Bearer ${connection.apiKeyPreview}`,
    ...connection.customHeaders
      .split("\n")
      .map((h) => h.trim())
      .filter((h) => h.length > 0 && h.includes(":")),
  ];
  const rows = buildParamRows(benchmark.tool, params, t);

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">{t("detail.requestSetup.title")}</h3>

      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-[120px_1fr]">
        <dt className="text-muted-foreground">{t("detail.requestDetails.method")}</dt>
        <dd className="font-mono">{method}</dd>

        <dt className="text-muted-foreground">{t("detail.requestDetails.url")}</dt>
        <dd className="break-all font-mono text-xs">{url}</dd>

        <dt className="text-muted-foreground">{t("detail.requestDetails.headers")}</dt>
        <dd>
          <pre className="whitespace-pre-wrap break-all rounded-md border border-border bg-muted/30 p-2 font-mono text-xs">
            {displayHeaders.join("\n")}
          </pre>
        </dd>

        <dt className="text-muted-foreground">{t("detail.requestSetup.runConfig")}</dt>
        <dd className="font-mono text-xs">
          <ul className="space-y-0.5">
            {rows.map((r) => (
              <li key={r.label}>
                {r.label}: {r.value}
              </li>
            ))}
          </ul>
        </dd>
      </dl>

      <p className="text-xs text-muted-foreground">
        {t("detail.requestSetup.synthesizedHint", { tool: benchmark.tool })}
      </p>
    </div>
  );
}
