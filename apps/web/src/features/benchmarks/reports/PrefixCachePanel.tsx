import { prefixCacheAnnotationSchema } from "@modeldoctor/contracts";
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
  serverMetrics: unknown;
}

export function PrefixCachePanel({ serverMetrics }: Props) {
  const { t } = useTranslation("benchmarks");

  const parsed = prefixCacheAnnotationSchema.safeParse(
    (serverMetrics as { prefixCache?: unknown } | null)?.prefixCache,
  );

  if (!parsed.success) {
    return (
      <p className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
        {t("reports.prefixCache.noData")}
      </p>
    );
  }

  const data = parsed.data;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-muted-foreground">
        {t("reports.prefixCache.title")}
      </h3>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("reports.prefixCache.hitRate")}</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">
            {data.hitRatePct.toFixed(1)}%
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("reports.prefixCache.topPodShare")}</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">
            {data.topPodSharePct.toFixed(1)}%
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("reports.prefixCache.perPodTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("reports.prefixCache.perPodCols.pod")}</TableHead>
                <TableHead className="text-right">
                  {t("reports.prefixCache.perPodCols.queries")}
                </TableHead>
                <TableHead className="text-right">
                  {t("reports.prefixCache.perPodCols.hits")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.perPod.map((p) => (
                <TableRow key={p.pod}>
                  <TableCell className="font-mono text-sm">{p.pod}</TableCell>
                  <TableCell className="text-right">{p.queries}</TableCell>
                  <TableCell className="text-right">{p.hits}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
