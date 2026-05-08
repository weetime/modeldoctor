import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBenchmarkList } from "@/features/benchmarks/queries";
import { useConnection, useUpdateConnection } from "@/features/connections/queries";
import type { Benchmark, EndpointReportRange, ScenarioId } from "@modeldoctor/contracts";
import { ArrowLeft, SearchX } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { AiDiagnosisCard } from "./AiDiagnosisCard";
import { ProfileSelector } from "./ProfileSelector";
import { RadarChart } from "./RadarChart";
import { ScenarioPanel } from "./ScenarioPanel";
import { buildFindings } from "./buildFindings";
import { axisValue, compositeScore, scenarioScore } from "./evaluate";
import { useEvaluationProfiles } from "./queries";
import { getValidatedRange } from "./range";

function severityClass(score: number | null): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 85) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

const RANGES: EndpointReportRange[] = ["7d", "30d", "90d"];
const SCENARIOS: ScenarioId[] = ["inference", "capacity", "gateway"];

function rangeToISO(range: EndpointReportRange): string {
  const days = ({ "7d": 7, "30d": 30, "90d": 90 } as const)[range];
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function InsightsDetailPage() {
  const { t } = useTranslation("insights");
  const { connectionId = "" } = useParams<{ connectionId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const range = getValidatedRange(searchParams.get("range"));
  const profileSlug = searchParams.get("profile") ?? null;
  const rawScenario = searchParams.get("scenario");
  const activeScenario: ScenarioId =
    rawScenario === "inference" || rawScenario === "capacity" || rawScenario === "gateway"
      ? rawScenario
      : "inference";

  const conn = useConnection(connectionId);
  const profiles = useEvaluationProfiles();
  const updateConn = useUpdateConnection();
  const createdAfter = useMemo(() => rangeToISO(range), [range]);
  const list = useBenchmarkList({
    connectionId,
    createdAfter,
    limit: 100,
    scope: "own",
  });

  const runs: Benchmark[] = useMemo(() => list.data?.pages[0]?.items ?? [], [list.data]);

  const activeProfile = useMemo(() => {
    const slug = profileSlug ?? conn.data?.evaluationProfile?.slug ?? "default";
    return profiles.data?.items.find((p) => p.slug === slug);
  }, [profiles.data, profileSlug, conn.data]);

  const findings = useMemo(() => {
    if (!activeProfile) return [];
    return buildFindings(runs, activeProfile.rules);
  }, [runs, activeProfile]);

  const perScenarioFindings = useMemo(() => {
    return SCENARIOS.reduce(
      (acc, s) => {
        acc[s] = findings.filter((f) => f.scenario === s);
        return acc;
      },
      {} as Record<ScenarioId, typeof findings>,
    );
  }, [findings]);

  const subScores = useMemo(() => {
    return SCENARIOS.reduce(
      (acc, s) => {
        acc[s] = scenarioScore(perScenarioFindings[s]);
        return acc;
      },
      {} as Record<ScenarioId, number | null>,
    );
  }, [perScenarioFindings]);

  const composite = useMemo(() => compositeScore(subScores), [subScores]);

  const overallAxisValues = useMemo(
    () => ({
      responsiveness: axisValue("responsiveness", findings),
      smoothness: axisValue("smoothness", findings),
      throughput: axisValue("throughput", findings),
      stability: axisValue("stability", findings),
      tail: axisValue("tail", findings),
      efficiency: axisValue("efficiency", findings),
    }),
    [findings],
  );

  const perScenarioAxisValues = useMemo(() => {
    return SCENARIOS.reduce(
      (acc, s) => {
        const f = perScenarioFindings[s];
        acc[s] = {
          responsiveness: axisValue("responsiveness", f),
          smoothness: axisValue("smoothness", f),
          throughput: axisValue("throughput", f),
          stability: axisValue("stability", f),
          tail: axisValue("tail", f),
          efficiency: axisValue("efficiency", f),
        };
        return acc;
      },
      {} as Record<ScenarioId, Record<string, number | null>>,
    );
  }, [perScenarioFindings]);

  const runsByScenario = useMemo(() => {
    return SCENARIOS.reduce(
      (acc, s) => {
        acc[s] = runs.filter((r) => r.scenario === s);
        return acc;
      },
      {} as Record<ScenarioId, Benchmark[]>,
    );
  }, [runs]);

  if ((conn.error as { status?: number } | null)?.status === 404) {
    return (
      <>
        <PageHeader title={connectionId} />
        <div className="px-8 py-6">
          <EmptyState icon={SearchX} title="404" body={t("detail.notFound")} />
        </div>
      </>
    );
  }
  if (conn.isLoading || profiles.isLoading) {
    return (
      <>
        <PageHeader title="…" />
        <div className="m-8 h-64 animate-pulse rounded-md border border-border bg-muted/30" />
      </>
    );
  }
  if (!conn.data || !profiles.data) return null;

  const profileDirty = !!activeProfile && conn.data?.evaluationProfile?.slug !== activeProfile.slug;

  function setRange(next: EndpointReportRange) {
    const sp = new URLSearchParams(searchParams);
    sp.set("range", next);
    setSearchParams(sp);
  }
  function setProfile(slug: string) {
    const sp = new URLSearchParams(searchParams);
    sp.set("profile", slug);
    setSearchParams(sp);
  }
  function setScenario(s: string) {
    const sp = new URLSearchParams(searchParams);
    if (s === "inference") sp.delete("scenario");
    else sp.set("scenario", s);
    setSearchParams(sp);
  }

  const totalChecks = findings.filter((f) => f.severity !== "no_data").length;
  const rangeDays = ({ "7d": 7, "30d": 30, "90d": 90 } as const)[range];

  return (
    <>
      <PageHeader
        title={conn.data.name}
        subtitle={`${conn.data.baseUrl} · ${conn.data.model} · ${conn.data.category}`}
        rightSlot={
          <div className="flex items-center gap-2">
            <ProfileSelector
              value={activeProfile?.slug ?? "default"}
              options={profiles.data.items}
              onChange={setProfile}
            />
            {profileDirty && activeProfile && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  updateConn.mutate({
                    id: connectionId,
                    body: { evaluationProfileId: activeProfile.id },
                  })
                }
                disabled={updateConn.isPending}
              >
                {t("detail.profile.setDefault")}
              </Button>
            )}
            <Select value={range} onValueChange={(v) => setRange(v as EndpointReportRange)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`detail.range.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button asChild variant="ghost" size="sm">
              <Link to="/benchmarks/reports">
                <ArrowLeft className="mr-1 h-4 w-4" />
                {t("detail.backToIndex")}
              </Link>
            </Button>
          </div>
        }
      />
      <div className="space-y-6 px-8 py-6">
        {/* Hero band */}
        <Card>
          <CardContent className="grid grid-cols-1 items-center gap-6 p-8 md:grid-cols-[auto_220px_1fr]">
            {/* Composite score block */}
            <div className="flex flex-col items-start">
              <div className="flex items-baseline gap-2">
                <span
                  data-testid="composite-score"
                  className={`text-7xl font-bold leading-none tabular-nums tracking-tight ${severityClass(composite)}`}
                >
                  {composite ?? "—"}
                </span>
                <span className="text-2xl font-medium text-muted-foreground">/ 100</span>
              </div>
              <div className="mt-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                {t("detail.compositeScore")}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t("detail.checks", { count: totalChecks })} ·{" "}
                {t("detail.runs", { count: runs.length })} · {t("detail.in", { days: rangeDays })}
              </div>
            </div>
            {/* Radar chart */}
            <div className="flex justify-center md:justify-start">
              <RadarChart values={overallAxisValues} size={200} />
            </div>
            {/* Per-scenario KPI tiles */}
            <div className="grid grid-cols-3 gap-3">
              {SCENARIOS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScenario(s)}
                  className={`group rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent ${
                    activeScenario === s ? "border-primary ring-1 ring-primary/30" : "border-border"
                  }`}
                >
                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t(`detail.scenario.${s}`)}
                  </div>
                  <div
                    data-testid={`subscore-${s}`}
                    className={`mt-1 text-3xl font-bold tabular-nums ${severityClass(subScores[s])}`}
                  >
                    {subScores[s] ?? "—"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {t("detail.runs", { count: runsByScenario[s].length })}
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Scenario tabs — full-width */}
        <Tabs value={activeScenario} onValueChange={setScenario}>
          <TabsList className="grid w-full grid-cols-3">
            {SCENARIOS.map((s) => (
              <TabsTrigger key={s} value={s} className="gap-1.5">
                {t(`detail.scenario.${s}`)}
                <span
                  className={`tabular-nums text-xs ${
                    subScores[s] == null ? "text-muted-foreground" : "font-semibold"
                  }`}
                >
                  {subScores[s] ?? "—"}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          {SCENARIOS.map((s) => (
            <TabsContent key={s} value={s} className="mt-4">
              <ScenarioPanel
                scenario={s}
                subScore={subScores[s]}
                axisValues={perScenarioAxisValues[s]}
                findings={perScenarioFindings[s]}
                runs={runsByScenario[s]}
                connectionId={connectionId}
                rangeFromISO={createdAfter}
              />
            </TabsContent>
          ))}
        </Tabs>

        {/* AI diagnosis — full-width at the bottom */}
        <AiDiagnosisCard
          connectionId={connectionId}
          profileSlug={activeProfile?.slug ?? "default"}
          range={range}
          runIds={runs.map((r) => r.id)}
        />
      </div>
    </>
  );
}
