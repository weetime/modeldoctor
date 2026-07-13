// apps/web/src/features/insights/InsightsMatrixPage.tsx
import type {
  EndpointReportRange,
  MatrixAggregate,
  ModalityCategory,
} from "@modeldoctor/contracts";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
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
import { MatrixGrid } from "./MatrixGrid";
import { useInsightsMatrix } from "./matrix-queries";
import { ProfileSelector } from "./ProfileSelector";
import { useEvaluationProfiles } from "./queries";
import { getValidatedRange } from "./range";

const AGGREGATES: MatrixAggregate[] = ["scenario", "tool", "engine"];
const RANGES: EndpointReportRange[] = ["7d", "30d", "90d"];
const CATEGORIES: ModalityCategory[] = ["chat", "audio", "embeddings", "rerank", "image"];

function getValidatedAggregate(raw: string | null): MatrixAggregate {
  return raw === "tool" || raw === "engine" ? raw : "scenario";
}

export function InsightsMatrixPage() {
  const { t } = useTranslation("insights");
  const { t: tConn } = useTranslation("connections");
  const [searchParams, setSearchParams] = useSearchParams();

  const aggregate = getValidatedAggregate(searchParams.get("aggregate"));
  const range = getValidatedRange(searchParams.get("range"));
  const profileSlug = searchParams.get("profile");
  const q = searchParams.get("q") ?? "";
  const categoryRaw = searchParams.get("category");
  const category: ModalityCategory | "all" =
    categoryRaw && (CATEGORIES as string[]).includes(categoryRaw)
      ? (categoryRaw as ModalityCategory)
      : "all";

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

  const filteredData = useMemo(() => {
    if (!matrix.data) return undefined;
    const needle = q.trim().toLowerCase();
    const endpoints = matrix.data.endpoints.filter((endpoint) => {
      if (category !== "all" && endpoint.category !== category) return false;
      if (needle) {
        const haystack = `${endpoint.model} ${endpoint.name}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
    return { ...matrix.data, endpoints };
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
          </div>
        </div>

        <MatrixGrid data={filteredData} />
      </div>
    </>
  );
}
