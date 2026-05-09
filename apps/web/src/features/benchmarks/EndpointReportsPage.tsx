import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEvaluationProfiles } from "@/features/insights/queries";
import { getValidatedRange } from "@/features/insights/range";
import type { EndpointReportRange } from "@modeldoctor/contracts";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, BarChart3, Search } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { TrendIndicator } from "./TrendIndicator";
import { useEndpointReports } from "./queries";
import { StatusBadge } from "./status-display";

const RANGES: EndpointReportRange[] = ["7d", "30d", "90d"];
const ALL = "__all__";

export function EndpointReportsPage() {
  const { t } = useTranslation("benchmarks");
  const [searchParams, setSearchParams] = useSearchParams();
  const range = getValidatedRange(searchParams.get("range"));
  const q = searchParams.get("q") ?? "";
  const category = searchParams.get("category") ?? ALL;
  const profileFilter = searchParams.get("profile") ?? ALL;

  const { data, isLoading } = useEndpointReports(range);
  const profiles = useEvaluationProfiles();

  function update(next: Partial<{ range: string; q: string; category: string; profile: string }>) {
    const sp = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === "" || v === ALL) sp.delete(k);
      else sp.set(k, v);
    }
    setSearchParams(sp);
  }

  const categories = useMemo(() => {
    const set = new Set<string>();
    data?.items.forEach((it) => set.add(it.connection.category));
    return [...set].sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const ql = q.toLowerCase();
    return data.items.filter((it) => {
      if (
        ql &&
        !it.connection.name.toLowerCase().includes(ql) &&
        !it.connection.model.toLowerCase().includes(ql)
      )
        return false;
      if (category !== ALL && it.connection.category !== category) return false;
      // profile filter applies to the connection's evaluationProfile slug;
      // if not yet returned by endpoint, treat all as passing
      if (
        profileFilter !== ALL &&
        (it as any).connection?.evaluationProfile?.slug !== profileFilter
      )
        return false;
      return true;
    });
  }, [data, q, category, profileFilter]);

  return (
    <>
      <PageHeader title={t("reports.title")} subtitle={t("reports.subtitle")} />
      <div className="space-y-6 px-8 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("reports.filters.search")}
              value={q}
              onChange={(e) => update({ q: e.target.value })}
              className="pl-9"
            />
          </div>
          <Select value={category} onValueChange={(v) => update({ category: v })}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder={t("reports.filters.category")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("reports.filters.categoryAll")}</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={profileFilter} onValueChange={(v) => update({ profile: v })}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t("reports.filters.profile")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("reports.filters.profileAll")}</SelectItem>
              {profiles.data?.items.map((p) => (
                <SelectItem key={p.slug} value={p.slug}>
                  {p.nameKey ? t(p.nameKey, { defaultValue: p.name }) : p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={range} onValueChange={(v) => update({ range: v })}>
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

        {isLoading ? (
          <div
            role="status"
            aria-label="loading"
            className="h-64 animate-pulse rounded-md border border-border bg-muted/30"
          />
        ) : !data || filtered.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title={
              data?.items.length === 0 ? t("reports.empty.title") : t("reports.filters.noResults")
            }
            body={data?.items.length === 0 ? t("reports.empty.body") : ""}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((item) => (
              <Card key={item.connection.id}>
                <CardHeader className="space-y-1.5">
                  <div className="flex items-baseline gap-2">
                    <h3 className="font-semibold leading-tight">{item.connection.model}</h3>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{item.connection.name}</span>
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
                        ? t("reports.summary.successRate", { rate: item.successRate.toFixed(1) })
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
                      <Link to={`/insights/${item.connection.id}?range=${range}`}>
                        {t("reports.viewDetail")}
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
