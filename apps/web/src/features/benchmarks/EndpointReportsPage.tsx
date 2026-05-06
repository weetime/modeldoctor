import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { EndpointReportRange } from "@modeldoctor/contracts";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, BarChart3 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { TrendIndicator } from "./TrendIndicator";
import { useEndpointReports } from "./queries";
import { StatusBadge } from "./status-display";

const RANGES: EndpointReportRange[] = ["7d", "30d", "90d"];

export function EndpointReportsPage() {
  const { t } = useTranslation("benchmarks");
  const [range, setRange] = useState<EndpointReportRange>("30d");
  const { data, isLoading } = useEndpointReports(range);

  return (
    <>
      <PageHeader
        title={t("reports.title")}
        subtitle={t("reports.subtitle")}
        rightSlot={
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t("reports.rangeLabel")}</span>
            <Select value={range} onValueChange={(v) => setRange(v as EndpointReportRange)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`reports.ranges.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />
      <div className="space-y-6 px-8 py-6">
        {isLoading ? (
          <div
            role="status"
            aria-label="loading"
            className="h-64 animate-pulse rounded-md border border-border bg-muted/30"
          />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title={t("reports.empty.title")}
            body={t("reports.empty.body")}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {data.items.map((item) => (
              <Card key={item.connection.id}>
                <CardHeader className="space-y-1.5">
                  <div className="flex items-baseline gap-2">
                    <h3 className="font-semibold leading-tight">{item.connection.name}</h3>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{item.connection.model}</span>
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground/70">
                    {item.connection.baseUrl}
                  </div>
                  <div>
                    <Badge variant="outline" className="text-[10px]">
                      {item.connection.category}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="space-y-1 text-muted-foreground">
                    <div>
                      {t("reports.summary.totalRuns", { count: item.totalRuns })} ·{" "}
                      {item.successRate != null
                        ? t("reports.summary.successRate", {
                            rate: item.successRate.toFixed(1),
                          })
                        : t("reports.summary.successRateMissing")}
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="cursor-help text-xs">
                          {t("reports.summary.statusBreakdown", {
                            completed: item.statusCounts.completed,
                            failed: item.statusCounts.failed,
                            canceled: item.statusCounts.canceled,
                          })}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>{t("reports.summary.statusBreakdownTooltip")}</TooltipContent>
                    </Tooltip>
                  </div>
                  <div>
                    p95:{" "}
                    <TrendIndicator
                      first={item.p95Latency?.first ?? null}
                      last={item.p95Latency?.last ?? null}
                      unitSuffix="ms"
                    />
                  </div>
                  {item.latestRun ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">
                        {t("reports.summary.latest", {
                          name: item.latestRun.name,
                          when: formatDistanceToNow(new Date(item.latestRun.createdAt), {
                            addSuffix: true,
                          }),
                        })}
                      </span>
                      <StatusBadge status={item.latestRun.status} iconOnly />
                    </div>
                  ) : null}
                  <div className="pt-2">
                    <Button asChild variant="outline" size="sm" className="gap-1">
                      <Link to={`/benchmarks/reports/${item.connection.id}?range=${range}`}>
                        {t("reports.viewHistory")}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
