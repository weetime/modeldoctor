import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { Run } from "@modeldoctor/contracts";
import { useQueries } from "@tanstack/react-query";
import { ArrowLeft, ListChecks } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { runApi } from "../api";
import { runKeys } from "../queries";
import { CompareGrid } from "./CompareGrid";
import { CompareToolbar } from "./CompareToolbar";

function parseIds(searchParams: URLSearchParams): string[] {
  const raw = searchParams.get("ids") ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function RunComparePage() {
  const { t } = useTranslation("runs");
  const [searchParams, setSearchParams] = useSearchParams();
  const ids = useMemo(() => parseIds(searchParams), [searchParams]);
  const baselineId = searchParams.get("baseline");

  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: runKeys.detail(id),
      queryFn: () => runApi.get(id),
      enabled: id.length > 0,
      retry: false,
    })),
  });

  const successfulRuns: Run[] = queries.map((q) => q.data).filter((r): r is Run => !!r);
  const failedCount = queries.filter((q) => q.isError).length;
  const isLoading = queries.some((q) => q.isLoading);

  const tools = new Set(successfulRuns.map((r) => r.tool));
  const isMixed = tools.size > 1;

  // Default baseline: first selected Run that is itself a baseline (baselineFor !== null);
  // otherwise null. URL ?baseline= takes precedence when present and valid.
  const defaultBaseline = useMemo(() => {
    if (baselineId && successfulRuns.some((r) => r.id === baselineId)) return baselineId;
    if (baselineId) return null; // URL had a value but no matching run
    const inferred = successfulRuns.find((r) => r.baselineFor !== null);
    return inferred?.id ?? null;
  }, [baselineId, successfulRuns]);

  function handleBaselineChange(next: string | null) {
    const sp = new URLSearchParams();
    if (ids.length > 0) sp.set("ids", ids.join(","));
    if (next) sp.set("baseline", next);
    setSearchParams(sp);
  }

  if (ids.length < 2) {
    return (
      <>
        <PageHeader title={t("compare.title")} />
        <EmptyState
          icon={ListChecks}
          title={t("compare.needTwoEmpty")}
          actions={
            <Button asChild variant="outline" size="sm">
              <Link to="/runs">
                <ArrowLeft className="mr-1 h-4 w-4" />
                {t("compare.back")}
              </Link>
            </Button>
          }
        />
      </>
    );
  }

  const subtitle =
    successfulRuns.length > 0
      ? t("compare.subtitle", { n: successfulRuns.length, tool: successfulRuns[0].tool })
      : "";

  return (
    <>
      <PageHeader
        title={t("compare.title")}
        subtitle={subtitle}
        rightSlot={
          <Button asChild variant="ghost" size="sm">
            <Link to="/runs">
              <ArrowLeft className="mr-1 h-4 w-4" />
              {t("compare.back")}
            </Link>
          </Button>
        }
      />
      <div className="space-y-4 px-8 py-6">
        {failedCount > 0 && (
          <Alert>
            <AlertDescription>
              {t("compare.baselineMissing", { n: successfulRuns.length })}
            </AlertDescription>
          </Alert>
        )}
        {isMixed && (
          <Alert variant="destructive">
            <AlertDescription>
              {t("compare.mixedToolsAlert", { summary: [...tools].join(" + ") })}
            </AlertDescription>
          </Alert>
        )}
        {!isLoading && !isMixed && successfulRuns.length >= 2 && (
          <>
            <CompareToolbar
              runs={successfulRuns.map((r) => ({ id: r.id, name: r.name, tool: r.tool }))}
              baselineId={defaultBaseline}
              onBaselineChange={handleBaselineChange}
            />
            <CompareGrid runs={successfulRuns} baselineId={defaultBaseline} />
          </>
        )}
      </div>
    </>
  );
}
