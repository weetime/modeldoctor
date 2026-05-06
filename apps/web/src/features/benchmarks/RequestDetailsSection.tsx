import { Button } from "@/components/ui/button";
import { useConnection, useRevealApiKey } from "@/features/connections/queries";
import type { Benchmark } from "@modeldoctor/contracts";
import { type VegetaParams, migrateVegetaParams } from "@modeldoctor/tool-adapters/schemas";
import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

interface Props {
  benchmark: Benchmark;
}

function buildUrl(baseUrl: string, path: string, queryParams: string): string {
  let url = baseUrl.replace(/\/+$/, "") + path;
  const lines = queryParams
    .split("\n")
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p.includes("="));
  if (lines.length > 0) {
    url += (url.includes("?") ? "&" : "?") + lines.join("&");
  }
  return url;
}

function prettyBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function shEscape(s: string): string {
  // POSIX shell idiom: end the open quote, append \' (a literal '), reopen.
  return s.replace(/'/g, "'\\''");
}

function buildCurl(url: string, headers: string[], body: string): string {
  const headerArgs = headers.map((h) => ` -H '${shEscape(h)}'`).join("");
  return `curl -X POST '${shEscape(url)}'${headerArgs} -d '${shEscape(body)}'`;
}

export function RequestDetailsSection({ benchmark }: Props) {
  const { t } = useTranslation("benchmarks");
  const { data: connection, isLoading: connLoading } = useConnection(benchmark.connectionId);
  const { data: revealed, isLoading: keyLoading } = useRevealApiKey(benchmark.connectionId);

  if (!benchmark.connectionId) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("detail.requestDetails.connectionMissing")}
      </p>
    );
  }
  if (connLoading || keyLoading) {
    return <p className="text-sm text-muted-foreground">{t("detail.requestDetails.loading")}</p>;
  }
  if (!connection || !revealed) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("detail.requestDetails.connectionMissing")}
      </p>
    );
  }

  const migrated = migrateVegetaParams(
    benchmark.params as Partial<VegetaParams> & {
      apiType: VegetaParams["apiType"];
      rate: number;
      duration: number;
    },
    connection.model,
  );

  const url = buildUrl(connection.baseUrl, migrated.path, connection.queryParams);
  const headers = [
    "Content-Type: application/json",
    `Authorization: Bearer ${revealed.apiKey}`,
    ...connection.customHeaders
      .split("\n")
      .map((h) => h.trim())
      .filter((h) => h.length > 0 && h.includes(":")),
  ];
  const body = prettyBody(migrated.body);

  async function copyCurl() {
    const curl = buildCurl(url, headers, migrated.body);
    try {
      await navigator.clipboard.writeText(curl);
      toast.success(t("detail.requestDetails.copySuccess"));
    } catch {
      toast.error(t("detail.requestDetails.copyError"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("detail.requestDetails.title")}</h3>
        <Button variant="outline" size="sm" onClick={copyCurl}>
          <Copy className="mr-1 h-4 w-4" />
          {t("detail.requestDetails.copyCurl")}
        </Button>
      </div>

      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-[120px_1fr]">
        <dt className="text-muted-foreground">{t("detail.requestDetails.method")}</dt>
        <dd className="font-mono">POST</dd>

        <dt className="text-muted-foreground">{t("detail.requestDetails.url")}</dt>
        <dd className="break-all font-mono text-xs">{url}</dd>

        <dt className="text-muted-foreground">{t("detail.requestDetails.headers")}</dt>
        <dd>
          <pre className="whitespace-pre-wrap break-all rounded-md border border-border bg-muted/30 p-2 font-mono text-xs">
            {headers.join("\n")}
          </pre>
        </dd>

        <dt className="text-muted-foreground">{t("detail.requestDetails.body")}</dt>
        <dd>
          <pre className="overflow-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-xs">
            {body}
          </pre>
        </dd>

        <dt className="text-muted-foreground">{t("detail.requestDetails.params")}</dt>
        <dd className="font-mono text-xs">
          <ul className="space-y-0.5">
            <li>
              {t("detail.requestDetails.paramKeys.apiType")}: {migrated.apiType}
            </li>
            <li>
              {t("detail.requestDetails.paramKeys.rate")}: {migrated.rate}
            </li>
            <li>
              {t("detail.requestDetails.paramKeys.duration")}: {migrated.duration}
            </li>
            <li>
              {t("detail.requestDetails.paramKeys.path")}: {migrated.path}
            </li>
          </ul>
        </dd>
      </dl>

      <p className="text-xs text-muted-foreground">{t("detail.requestDetails.hint")}</p>
    </div>
  );
}
