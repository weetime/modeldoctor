// apps/web/src/features/insights/InsightsMatrixPage.tsx
import type {
  EndpointReportRange,
  MatrixAggregate,
  ModalityCategory,
} from "@modeldoctor/contracts";
import { LayoutGrid, Share2 } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/common/page-header";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ForceMap } from "./ForceMap";
import { filterMatrixData } from "./matrix-filter";
import { MatrixGrid } from "./MatrixGrid";
import { useInsightsMatrix } from "./matrix-queries";
import { ProfileSelector } from "./ProfileSelector";
import { useEvaluationProfiles } from "./queries";
import { getValidatedRange } from "./range";
import { ScatterPanel } from "./ScatterPanel";

const AGGREGATES: MatrixAggregate[] = ["scenario", "tool", "engine"];
const RANGES: EndpointReportRange[] = ["7d", "30d", "90d"];
const CATEGORIES: ModalityCategory[] = ["chat", "audio", "embeddings", "rerank", "image"];
const VIEWS = ["grid", "map"] as const;
type MatrixView = (typeof VIEWS)[number];

function getValidatedAggregate(raw: string | null): MatrixAggregate {
  return raw === "tool" || raw === "engine" ? raw : "scenario";
}

function getValidatedView(raw: string | null): MatrixView {
  return raw === "map" ? "map" : "grid";
}

export function InsightsMatrixPage() {
  const { t } = useTranslation("insights");
  const { t: tConn } = useTranslation("connections");
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const aggregate = getValidatedAggregate(searchParams.get("aggregate"));
  const range = getValidatedRange(searchParams.get("range"));
  const profileSlug = searchParams.get("profile");
  const q = searchParams.get("q") ?? "";
  const categoryRaw = searchParams.get("category");
  const category: ModalityCategory | "all" =
    categoryRaw && (CATEGORIES as string[]).includes(categoryRaw)
      ? (categoryRaw as ModalityCategory)
      : "all";
  const dimKey = searchParams.get("dim");
  const view = getValidatedView(searchParams.get("view"));

  const matrix = useInsightsMatrix({ aggregate, range, profile: profileSlug });
  const profiles = useEvaluationProfiles();

  function setAggregate(next: string) {
    const sp = new URLSearchParams(searchParams);
    if (next === "scenario") sp.delete("aggregate");
    else sp.set("aggregate", next);
    setSearchParams(sp);
  }
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
  function setQuery(next: string) {
    const sp = new URLSearchParams(searchParams);
    if (next.trim() === "") sp.delete("q");
    else sp.set("q", next);
    setSearchParams(sp);
  }
  function setCategory(next: string) {
    const sp = new URLSearchParams(searchParams);
    if (next === "all") sp.delete("category");
    else sp.set("category", next);
    setSearchParams(sp);
  }
  function setView(next: string) {
    const sp = new URLSearchParams(searchParams);
    if (next === "grid") sp.delete("view");
    else sp.set("view", next);
    setSearchParams(sp);
  }
  function openDim(key: string) {
    const sp = new URLSearchParams(searchParams);
    sp.set("dim", key);
    setSearchParams(sp);
  }
  function closeDim() {
    const sp = new URLSearchParams(searchParams);
    sp.delete("dim");
    setSearchParams(sp);
  }

  const filteredData = useMemo(() => {
    if (!matrix.data) return undefined;
    return filterMatrixData(matrix.data, { q, category: category === "all" ? null : category });
  }, [matrix.data, category, q]);

  if (matrix.isLoading || profiles.isLoading) {
    return (
      <>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <div className="px-8 py-6">
          <div
            role="status"
            aria-label="loading"
            className="h-64 animate-pulse rounded-md border border-border bg-muted/30"
          />
        </div>
      </>
    );
  }

  if (!filteredData || !profiles.data) return null;

  const activeDim = dimKey ? filteredData.dimensions.find((d) => d.key === dimKey) : undefined;
  const activeDimLabel = activeDim
    ? aggregate === "scenario"
      ? t(`detail.scenario.${activeDim.key}`, { defaultValue: activeDim.label })
      : activeDim.label
    : "";

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="px-8 py-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={aggregate} onValueChange={setAggregate}>
            <TabsList>
              {AGGREGATES.map((a) => (
                <TabsTrigger key={a} value={a}>
                  {t(`matrix.aggregate.${a}`, {
                    defaultValue: a === "scenario" ? "Scenario" : a === "tool" ? "Tool" : "Engine",
                  })}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={q}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("matrix.filters.searchPlaceholder", {
                defaultValue: "Search model or connection…",
              })}
              className="w-[220px]"
            />
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger
                className="w-[160px]"
                aria-label={t("matrix.filters.category", { defaultValue: "Category" })}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("matrix.filters.categoryAll", { defaultValue: "All categories" })}
                </SelectItem>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {tConn(`dialog.categoryOptions.${c}`, { defaultValue: c })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <ProfileSelector
              value={profileSlug ?? "default"}
              options={profiles.data.items}
              onChange={setProfile}
            />
            <Tabs value={view} onValueChange={setView}>
              <TabsList>
                <TabsTrigger value="grid" className="gap-1.5">
                  <LayoutGrid className="h-3.5 w-3.5" />
                  {t("matrix.view.grid", { defaultValue: "Grid" })}
                </TabsTrigger>
                <TabsTrigger value="map" className="gap-1.5">
                  <Share2 className="h-3.5 w-3.5" />
                  {t("matrix.view.map", { defaultValue: "Map" })}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        {view === "map" ? (
          <ForceMap
            data={filteredData}
            onNodeClick={(id) => navigate(`/insights/${id}?range=${range}`)}
          />
        ) : (
          <>
            <MatrixGrid data={filteredData} onDimClick={openDim} />

            {activeDim ? (
              <ScatterPanel
                dimKey={activeDim.key}
                dimLabel={activeDimLabel}
                data={filteredData}
                onClose={closeDim}
                onPointClick={(id) => navigate(`/insights/${id}?range=${range}`)}
              />
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
