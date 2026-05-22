import type { PrefixCacheProbeReport as Data } from "@modeldoctor/tool-adapters/schemas";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Props {
  data: Data;
}

export function PrefixCacheProbeReport({ data }: Props) {
  const { t } = useTranslation("benchmarks");
  const noQueries = data.perPod.every((p) => p.queries === 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("reports.prefixCacheProbe.stickiness")}</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">
            {data.stickinessPct.toFixed(1)}%
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("reports.prefixCacheProbe.deterministic")}</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">
            {data.deterministic
              ? t("reports.prefixCacheProbe.deterministicYes")
              : t("reports.prefixCacheProbe.deterministicNo")}
          </CardContent>
        </Card>
      </div>

      {noQueries && (
        <p className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          {t("reports.prefixCacheProbe.noQueries")}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("reports.prefixCacheProbe.promptSetsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("reports.prefixCacheProbe.promptSetsCols.label")}</TableHead>
                <TableHead>{t("reports.prefixCacheProbe.promptSetsCols.dominantPod")}</TableHead>
                <TableHead className="text-right">
                  {t("reports.prefixCacheProbe.promptSetsCols.dominantPct")}
                </TableHead>
                <TableHead className="text-right">
                  {t("reports.prefixCacheProbe.promptSetsCols.totalRequests")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.promptSets.map((s) => (
                <TableRow key={s.label}>
                  <TableCell>{s.label}</TableCell>
                  <TableCell className="font-mono text-sm">{s.dominantPod}</TableCell>
                  <TableCell className="text-right">{s.dominantPct.toFixed(1)}%</TableCell>
                  <TableCell className="text-right">{s.totalRequests}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("reports.prefixCacheProbe.perPodTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("reports.prefixCacheProbe.perPodCols.pod")}</TableHead>
                <TableHead className="text-right">
                  {t("reports.prefixCacheProbe.perPodCols.queries")}
                </TableHead>
                <TableHead className="text-right">
                  {t("reports.prefixCacheProbe.perPodCols.hits")}
                </TableHead>
                <TableHead className="text-right">
                  {t("reports.prefixCacheProbe.perPodCols.hitRate")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.perPod.map((p) => (
                <TableRow key={p.pod}>
                  <TableCell className="font-mono text-sm">{p.pod}</TableCell>
                  <TableCell className="text-right">{p.queries}</TableCell>
                  <TableCell className="text-right">{p.hits}</TableCell>
                  <TableCell className="text-right">
                    {p.queries > 0 ? `${((100 * p.hits) / p.queries).toFixed(1)}%` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
