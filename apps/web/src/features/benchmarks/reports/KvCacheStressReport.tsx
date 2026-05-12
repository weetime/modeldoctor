import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { KvCacheStressReport as Data } from "@modeldoctor/tool-adapters/schemas";
import { useTranslation } from "react-i18next";

interface Props {
  data: Data;
}

function statCard(label: string, value: string, hint?: string) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold">{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export function KvCacheStressReport({ data }: Props) {
  const { t } = useTranslation("benchmarks");
  const { qps, outputTps, requestsOk, requestsErr, errRatePct, ttftMs, e2eMs, prom, backend } =
    data;

  const sortedCounters = Object.entries(backend.counters).sort(([a], [b]) => a.localeCompare(b));

  // delta in percentage points between HBM hit rate and full savings — same
  // "hidden gain" framing used in the theriseunion/repots reports.
  const hiddenGainPp =
    prom.hbmHitRatePct !== undefined && prom.prefixCacheSavingsPct !== undefined
      ? prom.prefixCacheSavingsPct - prom.hbmHitRatePct
      : null;

  return (
    <div className="space-y-4">
      {/* Top-line stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {statCard(t("reports.kvCacheStress.qps"), qps.toFixed(2))}
        {statCard(t("reports.kvCacheStress.outputTps"), `${outputTps.toFixed(0)} tps`)}
        {statCard(
          t("reports.kvCacheStress.requests"),
          `${requestsOk} / ${requestsOk + requestsErr}`,
          `${requestsErr} err`,
        )}
        {statCard(t("reports.kvCacheStress.errRate"), `${errRatePct.toFixed(1)}%`)}
      </div>

      {/* Latency percentiles */}
      <Card>
        <CardHeader>
          <CardTitle>{t("reports.kvCacheStress.latency")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("reports.kvCacheStress.latencyMetric")}</TableHead>
                <TableHead className="text-right">p50 (ms)</TableHead>
                <TableHead className="text-right">p90 (ms)</TableHead>
                <TableHead className="text-right">p99 (ms)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>TTFT</TableCell>
                <TableCell className="text-right">{ttftMs.p50.toFixed(0)}</TableCell>
                <TableCell className="text-right">{ttftMs.p90.toFixed(0)}</TableCell>
                <TableCell className="text-right">{ttftMs.p99.toFixed(0)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>e2e</TableCell>
                <TableCell className="text-right">{e2eMs.p50.toFixed(0)}</TableCell>
                <TableCell className="text-right">{e2eMs.p90.toFixed(0)}</TableCell>
                <TableCell className="text-right">{e2eMs.p99.toFixed(0)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Prefix cache savings — only shown when Prom URL was set */}
      {(prom.hbmHitRatePct !== undefined || prom.prefixCacheSavingsPct !== undefined) && (
        <Card>
          <CardHeader>
            <CardTitle>{t("reports.kvCacheStress.savingsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <div className="text-muted-foreground">{t("reports.kvCacheStress.hbmHitRate")}</div>
                <div className="text-2xl font-semibold">
                  {prom.hbmHitRatePct !== undefined ? `${prom.hbmHitRatePct.toFixed(1)}%` : "—"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">
                  {t("reports.kvCacheStress.prefixCacheSavings")}
                </div>
                <div className="text-2xl font-semibold">
                  {prom.prefixCacheSavingsPct !== undefined
                    ? `${prom.prefixCacheSavingsPct.toFixed(1)}%`
                    : "—"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">{t("reports.kvCacheStress.hiddenGain")}</div>
                <div className="text-2xl font-semibold">
                  {hiddenGainPp !== null ? `+${hiddenGainPp.toFixed(1)} pp` : "—"}
                </div>
              </div>
            </div>
            <p className="text-muted-foreground">{t("reports.kvCacheStress.savingsExplainer")}</p>
          </CardContent>
        </Card>
      )}

      {/* Backend native counters */}
      <Card>
        <CardHeader>
          <CardTitle>
            {t("reports.kvCacheStress.backendTitle", { name: backend.nameGuess })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sortedCounters.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("reports.kvCacheStress.backendEmpty")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("reports.kvCacheStress.counterName")}</TableHead>
                  <TableHead className="text-right">
                    {t("reports.kvCacheStress.counterValue")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedCounters.map(([name, value]) => (
                  <TableRow key={name}>
                    <TableCell className="font-mono text-xs">{name}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {typeof value === "number" ? value.toLocaleString() : value}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
