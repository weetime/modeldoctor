import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useConnection, useUpdateConnection } from "@/features/connections/queries";
import { useBenchmarkList } from "@/features/benchmarks/queries";
import type { Benchmark, EndpointReportRange, ScenarioId } from "@modeldoctor/contracts";
import { ArrowLeft, SearchX } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AiDiagnosisCard } from "./AiDiagnosisCard";
import { ProfileSelector } from "./ProfileSelector";
import { ScenarioPanel } from "./ScenarioPanel";
import { ScoreBanner } from "./ScoreBanner";
import { buildFindings } from "./buildFindings";
import { axisValue, compositeScore, scenarioScore } from "./evaluate";
import { useEvaluationProfiles } from "./queries";

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
  const rawRange = searchParams.get("range");
  const range: EndpointReportRange =
    rawRange === "7d" || rawRange === "30d" || rawRange === "90d" ? rawRange : "30d";
  const profileSlug = searchParams.get("profile") ?? null;

  const conn = useConnection(connectionId);
  const profiles = useEvaluationProfiles();
  const updateConn = useUpdateConnection();
  const createdAfter = useMemo(() => rangeToISO(range), [range]);
  const list = useBenchmarkList({
    connectionId, createdAfter, limit: 100, scope: "own",
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
    return SCENARIOS.reduce((acc, s) => {
      acc[s] = findings.filter((f) => f.scenario === s);
      return acc;
    }, {} as Record<ScenarioId, typeof findings>);
  }, [findings]);

  const subScores = useMemo(() => {
    return SCENARIOS.reduce((acc, s) => {
      acc[s] = scenarioScore(perScenarioFindings[s]);
      return acc;
    }, {} as Record<ScenarioId, number | null>);
  }, [perScenarioFindings]);

  const composite = useMemo(() => compositeScore(subScores), [subScores]);

  const overallAxisValues = useMemo(() => ({
    responsiveness: axisValue("responsiveness", findings),
    smoothness: axisValue("smoothness", findings),
    throughput: axisValue("throughput", findings),
    stability: axisValue("stability", findings),
    tail: axisValue("tail", findings),
    efficiency: axisValue("efficiency", findings),
  }), [findings]);

  const perScenarioAxisValues = useMemo(() => {
    return SCENARIOS.reduce((acc, s) => {
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
    }, {} as Record<ScenarioId, Record<string, number | null>>);
  }, [perScenarioFindings]);

  const runsByScenario = useMemo(() => {
    return SCENARIOS.reduce((acc, s) => {
      acc[s] = runs.filter((r) => r.scenario === s);
      return acc;
    }, {} as Record<ScenarioId, Benchmark[]>);
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

  const profileDirty =
    !!activeProfile &&
    conn.data?.evaluationProfile?.slug !== activeProfile.slug;

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

  return (
    <>
      <PageHeader
        title={conn.data.name}
        subtitle={`${conn.data.baseUrl} · ${conn.data.model} · ${conn.data.category}`}
        rightSlot={
          <Button asChild variant="ghost" size="sm">
            <Link to="/benchmarks/reports"><ArrowLeft className="mr-1 h-4 w-4" />{t("detail.backToIndex")}</Link>
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-6 px-8 py-6 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <ScoreBanner
            compact
            composite={composite}
            perScenario={subScores}
            totalChecks={findings.filter((f) => f.severity !== "no_data").length}
            totalRuns={runs.length}
            rangeDays={({ "7d": 7, "30d": 30, "90d": 90 } as const)[range]}
            axisValues={overallAxisValues}
          />
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">{t("detail.profile.label")}</div>
                <ProfileSelector
                  value={activeProfile?.slug ?? "default"}
                  options={profiles.data.items}
                  onChange={setProfile}
                />
                {profileDirty && activeProfile && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-full justify-start px-2 text-xs"
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
              </div>
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">{t("detail.in", { days: ({ "7d": 7, "30d": 30, "90d": 90 } as const)[range] })}</div>
                <Select value={range} onValueChange={(v) => setRange(v as EndpointReportRange)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RANGES.map((r) => (
                      <SelectItem key={r} value={r}>{r === "7d" ? "近 7 天" : r === "30d" ? "近 30 天" : "近 90 天"}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </aside>
        <main className="min-w-0 space-y-6">
          <AiDiagnosisCard
            connectionId={connectionId}
            profileSlug={activeProfile?.slug ?? "default"}
            range={range}
            runIds={runs.map((r) => r.id)}
          />
          {SCENARIOS.map((s) => (
            <ScenarioPanel
              key={s}
              scenario={s}
              subScore={subScores[s]}
              axisValues={perScenarioAxisValues[s]}
              findings={perScenarioFindings[s]}
              runs={runsByScenario[s]}
              connectionId={connectionId}
              rangeFromISO={createdAfter}
            />
          ))}
        </main>
      </div>
    </>
  );
}
