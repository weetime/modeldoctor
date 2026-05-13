// Deep link: /benchmarks/compare/saved/new?evaluationRunIds=id1,id2
// Triggered from RunsListPage (multi-select toolbar) and RunReportPage
// (Add to Compare button). On mount we prefill evaluationRunIds and,
// once their createdAt timestamps load, auto-fill stageLabels with
// "Latest / Previous / Older" or YYYY-MM-DD strings.

import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useEvaluationRunsByIds } from "@/features/quality-gate/queries";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useCreateSavedCompare } from "./queries";

export function SavedCompareCreatePage() {
  const { t } = useTranslation("benchmarks");
  const { t: tSidebar } = useTranslation("sidebar");
  const navigate = useNavigate();
  const create = useCreateSavedCompare();

  const [searchParams] = useSearchParams();
  const prefilledIdsParam = searchParams.get("evaluationRunIds");
  const prefilledIds = prefilledIdsParam ? prefilledIdsParam.split(",").filter(Boolean) : [];

  const [name, setName] = useState("");
  const [context, setContext] = useState("");
  const [stageLabels, setStageLabels] = useState<Record<string, string>>(() => {
    // Optimistic initial labels — will be replaced once run data loads
    return Object.fromEntries(prefilledIds.map((id) => [id, ""]));
  });

  const userEditedStageLabels = useRef(false);

  const selected = useEvaluationRunsByIds(prefilledIds);

  // Auto-fill stageLabels once run createdAt timestamps load — but only if user hasn't edited
  useEffect(() => {
    if (!selected.data) return;
    if (userEditedStageLabels.current) return;

    const sorted = [...selected.data].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const labels = sorted.map((r, i) => {
      if (i === 0) return [r.id, t("compare.autoLabel.latest")];
      if (i === 1) return [r.id, t("compare.autoLabel.previous")];
      if (i === 2) return [r.id, t("compare.autoLabel.older")];
      return [r.id, new Date(r.createdAt).toISOString().slice(0, 10)];
    });
    setStageLabels(Object.fromEntries(labels));
  }, [selected.data, t]);

  const runIds = prefilledIds;
  const allLabelled = runIds.every((id) => stageLabels[id]?.trim());
  const canSubmit =
    name.trim().length > 0 && runIds.length >= 2 && allLabelled && !create.isPending;

  async function submit() {
    if (!canSubmit) return;
    const sc = await create.mutateAsync({
      name: name.trim(),
      benchmarkIds: [],
      evaluationRunIds: runIds,
      stageLabels: Object.fromEntries(runIds.map((id) => [id, (stageLabels[id] ?? "").trim()])),
      context: context.trim() || undefined,
    });
    navigate(`/benchmarks/compare/saved/${sc.id}`);
  }

  const breadcrumbs = [
    { label: tSidebar("groups.benchmarks") },
    { label: t("compare.title"), to: "/benchmarks/compare/saved" },
    { label: t("savedCompare.dialog.title") },
  ];

  return (
    <>
      <PageHeader title={t("savedCompare.dialog.title")} breadcrumbs={breadcrumbs} />
      <div className="px-8 py-6 space-y-6">
        <div className="max-w-lg space-y-4">
          {runIds.length < 2 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {t("compareDisabledNeedTwo")}
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="sc-name">{t("savedCompare.dialog.nameLabel")}</Label>
            <Input
              id="sc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("savedCompare.dialog.namePlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">{t("savedCompare.dialog.stageLabelsTitle")}</div>
            <div className="text-xs text-muted-foreground">
              {t("savedCompare.dialog.stageLabelsHint")}
            </div>
            <div className="space-y-2">
              {runIds.map((id) => {
                const runData = selected.data?.find((r) => r.id === id);
                return (
                  <div key={id} className="grid grid-cols-[1fr_auto] items-center gap-2">
                    <Label htmlFor={`label-${id}`} className="text-sm font-normal tabular-nums">
                      {runData ? new Date(runData.createdAt).toLocaleString() : id.slice(0, 12)}
                    </Label>
                    <Input
                      id={`label-${id}`}
                      aria-label={id}
                      className="w-32"
                      value={stageLabels[id] ?? ""}
                      onChange={(e) => {
                        userEditedStageLabels.current = true;
                        setStageLabels((p) => ({ ...p, [id]: e.target.value }));
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="sc-ctx">{t("savedCompare.dialog.contextLabel")}</Label>
            <Textarea
              id="sc-ctx"
              rows={4}
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder={t("savedCompare.dialog.contextPlaceholder")}
            />
          </div>

          {create.error ? (
            <div className="text-sm text-rose-600">{create.error.message}</div>
          ) : null}

          <div className="flex gap-2">
            <Button onClick={submit} disabled={!canSubmit}>
              {t("savedCompare.dialog.submit")}
            </Button>
            <Button variant="outline" onClick={() => navigate(-1)}>
              {t("savedCompare.dialog.cancel")}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
